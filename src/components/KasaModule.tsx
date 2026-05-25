import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wallet, Plus, X, TrendingUp, TrendingDown, ChevronDown,
  DollarSign, Trash2, Lock, Edit2, AlertCircle, CheckCircle
} from 'lucide-react';
import { db } from '../firebase';
import { byField } from '../utils/fsSort';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, serverTimestamp
} from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

type HareketTur = 'Giriş' | 'Çıkış';
type KasaDoviz = 'TRY' | 'USD' | 'EUR';
type KasaDurum = 'Aktif' | 'Pasif';

interface Kasa {
  id: string;
  ad: string;
  doviz: KasaDoviz;
  sorumlu: string;
  durum: KasaDurum;
  createdAt?: unknown;
}

interface KasaHareketi {
  id: string;
  kasaId: string;
  kasaAd: string;
  tur: HareketTur;
  tutar: number;
  aciklama: string;
  belgeNo: string;
  tarih: string;
  createdAt?: unknown;
}

interface KasaKapanis {
  id: string;
  tarih: string;
  acilisBakiye: number;
  toplamGiris: number;
  toplamCikis: number;
  kapanisBakiye: number;
  kapatan: string;
  createdAt?: unknown;
}

interface KasaModuleProps {
  currentLanguage: string;
  isAuthenticated: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const cn = (...classes: unknown[]) => classes.filter(Boolean).join(' ');

const DOVIZ_SYMBOL: Record<KasaDoviz, string> = { TRY: '₺', USD: '$', EUR: '€' };

function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const show = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };
  return { toast, show };
}

function fmtMoney(n: number, symbol = '₺') {
  return `${symbol}${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TODAY = new Date().toISOString().split('T')[0];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KasaModule({ isAuthenticated }: KasaModuleProps) {
  const [activeTab, setActiveTab] = useState<'hareketler' | 'kapanis' | 'kasalar'>('hareketler');
  const { toast, show: showToast } = useToast();

  // Data
  const [kasalar, setKasalar] = useState<Kasa[]>([]);
  const [hareketler, setHareketler] = useState<KasaHareketi[]>([]);
  const [kapanislar, setKapanislar] = useState<KasaKapanis[]>([]);

  // Modal states
  const [showHareketModal, setShowHareketModal] = useState(false);
  const [showKasaModal, setShowKasaModal] = useState(false);
  const [editingKasa, setEditingKasa] = useState<Kasa | null>(null);
  const [deletingKasa, setDeletingKasa] = useState<string | null>(null);

  // Hareket form
  const [hForm, setHForm] = useState({
    kasaId: '',
    tur: 'Giriş' as HareketTur,
    tutar: '',
    aciklama: '',
    belgeNo: '',
    tarih: TODAY,
  });

  // Kasa form
  const [kForm, setKForm] = useState({
    ad: '',
    doviz: 'TRY' as KasaDoviz,
    sorumlu: '',
    durum: 'Aktif' as KasaDurum,
  });

  // Firestore listeners
  useEffect(() => {
    if (!isAuthenticated) return;
    const u1 = onSnapshot(query(collection(db, 'kasalar')), snap =>
      setKasalar(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Kasa, 'id'>) })).sort(byField('ad', 'asc'))));
    const u2 = onSnapshot(query(collection(db, 'kasaHareketleri')), snap =>
      setHareketler(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<KasaHareketi, 'id'>) })).sort(byField('tarih', 'desc'))));
    const u3 = onSnapshot(query(collection(db, 'kasaKapanislar')), snap =>
      setKapanislar(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<KasaKapanis, 'id'>) })).sort(byField('tarih', 'desc'))));
    return () => { u1(); u2(); u3(); };
  }, [isAuthenticated]);

  // Derived balance
  const toplamBakiye = useMemo(() => {
    const giris = hareketler.filter(h => h.tur === 'Giriş').reduce((s, h) => s + h.tutar, 0);
    const cikis = hareketler.filter(h => h.tur === 'Çıkış').reduce((s, h) => s + h.tutar, 0);
    return giris - cikis;
  }, [hareketler]);

  // Today's movements
  const todayHareketler = useMemo(() => hareketler.filter(h => h.tarih === TODAY), [hareketler]);
  const bugunGiris = useMemo(
    () => todayHareketler.filter(h => h.tur === 'Giriş').reduce((s, h) => s + h.tutar, 0),
    [todayHareketler]
  );
  const bugunCikis = useMemo(
    () => todayHareketler.filter(h => h.tur === 'Çıkış').reduce((s, h) => s + h.tutar, 0),
    [todayHareketler]
  );

  // Balance per kasa
  const kasaBakiye = useMemo(() => {
    const map: Record<string, number> = {};
    hareketler.forEach(h => {
      const prev = map[h.kasaId] ?? 0;
      map[h.kasaId] = prev + (h.tur === 'Giriş' ? h.tutar : -h.tutar);
    });
    return map;
  }, [hareketler]);

  // ── Hareket save ──
  const handleSaveHareket = async () => {
    if (!hForm.kasaId || !hForm.tutar || !hForm.aciklama) {
      showToast('Lütfen zorunlu alanları doldurun.', 'error');
      return;
    }
    const kasa = kasalar.find(k => k.id === hForm.kasaId);
    try {
      await addDoc(collection(db, 'kasaHareketleri'), {
        kasaId: hForm.kasaId,
        kasaAd: kasa?.ad ?? '',
        tur: hForm.tur,
        tutar: parseFloat(hForm.tutar) || 0,
        aciklama: hForm.aciklama,
        belgeNo: hForm.belgeNo,
        tarih: hForm.tarih,
        createdAt: serverTimestamp(),
      });
      showToast(`${hForm.tur} hareketi kaydedildi.`);
      setShowHareketModal(false);
      setHForm({ kasaId: '', tur: 'Giriş', tutar: '', aciklama: '', belgeNo: '', tarih: TODAY });
    } catch {
      showToast('Kayıt başarısız.', 'error');
    }
  };

  // ── Kasa save / update ──
  const handleSaveKasa = async () => {
    if (!kForm.ad) { showToast('Kasa adı gerekli.', 'error'); return; }
    try {
      if (editingKasa) {
        await updateDoc(doc(db, 'kasalar', editingKasa.id), { ...kForm });
        showToast('Kasa güncellendi.');
      } else {
        await addDoc(collection(db, 'kasalar'), { ...kForm, createdAt: serverTimestamp() });
        showToast('Yeni kasa oluşturuldu.');
      }
      setShowKasaModal(false);
      setEditingKasa(null);
      setKForm({ ad: '', doviz: 'TRY', sorumlu: '', durum: 'Aktif' });
    } catch {
      showToast('İşlem başarısız.', 'error');
    }
  };

  const handleDeleteKasa = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'kasalar', id));
      showToast('Kasa silindi.');
    } catch {
      showToast('Silme başarısız.', 'error');
    } finally {
      setDeletingKasa(null);
    }
  };

  // ── Günlük kapanış ──
  const alreadyClosedToday = kapanislar.some(k => k.tarih === TODAY);

  const handleGunuKapat = async () => {
    if (alreadyClosedToday) { showToast('Bugün zaten kapatıldı.', 'error'); return; }
    const lastKapanis = kapanislar[0];
    const acilisBakiye = lastKapanis ? lastKapanis.kapanisBakiye : 0;
    try {
      await addDoc(collection(db, 'kasaKapanislar'), {
        tarih: TODAY,
        acilisBakiye,
        toplamGiris: bugunGiris,
        toplamCikis: bugunCikis,
        kapanisBakiye: acilisBakiye + bugunGiris - bugunCikis,
        kapatan: 'Admin',
        createdAt: serverTimestamp(),
      });
      showToast('Günlük kapanış kaydedildi.');
    } catch {
      showToast('Kapanış başarısız.', 'error');
    }
  };

  const openKasaModal = (kasa?: Kasa) => {
    if (kasa) {
      setEditingKasa(kasa);
      setKForm({ ad: kasa.ad, doviz: kasa.doviz, sorumlu: kasa.sorumlu, durum: kasa.durum });
    } else {
      setEditingKasa(null);
      setKForm({ ad: '', doviz: 'TRY', sorumlu: '', durum: 'Aktif' });
    }
    setShowKasaModal(true);
  };

  return (
    <div className="space-y-5">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className={cn(
              'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg',
              toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
            )}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header / Balance card */}
      <div className={cn(
        'apple-card p-5 flex items-center justify-between gap-4',
        toplamBakiye > 0 ? 'border-l-4 border-green-500' : 'border-l-4 border-red-500'
      )}>
        <div className="flex items-center gap-4">
          <div className={cn(
            'w-14 h-14 rounded-2xl flex items-center justify-center',
            toplamBakiye > 0 ? 'bg-green-100' : 'bg-red-100'
          )}>
            <Wallet size={26} className={toplamBakiye > 0 ? 'text-green-600' : 'text-red-500'} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Toplam Kasa Bakiyesi</p>
            <p className={cn(
              'text-3xl font-bold tracking-tight',
              toplamBakiye > 0 ? 'text-green-600' : 'text-red-500'
            )}>
              {fmtMoney(toplamBakiye)}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setShowHareketModal(true);
            setHForm(f => ({ ...f, kasaId: kasalar[0]?.id ?? '', tarih: TODAY }));
          }}
          className="apple-button-primary flex items-center gap-1.5 px-4 py-2 text-sm"
        >
          <Plus size={15} />
          Hareket Ekle
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="overflow-x-auto scrollbar-none">
        <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
        {[
          { key: 'hareketler', label: 'Hareketler' },
          { key: 'kapanis', label: 'Günlük Kapanış' },
          { key: 'kasalar', label: 'Kasalar' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`shrink-0 inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${activeTab === tab.key ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}
          >
            {tab.label}
          </button>
        ))}
        </div>
      </div>

      {/* ── TAB: Hareketler ── */}
      {activeTab === 'hareketler' && (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Bugünkü Giriş', value: bugunGiris, icon: <TrendingUp size={16} />, color: 'text-green-600 bg-green-50', positive: true },
              { label: 'Bugünkü Çıkış', value: bugunCikis, icon: <TrendingDown size={16} />, color: 'text-red-600 bg-red-50', positive: false },
              { label: 'Toplam Bakiye', value: toplamBakiye, icon: <DollarSign size={16} />, color: 'text-blue-600 bg-blue-50', positive: toplamBakiye >= 0 },
            ].map(kpi => (
              <div key={kpi.label} className="apple-card p-4 flex items-center gap-3">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', kpi.color)}>
                  {kpi.icon}
                </div>
                <div>
                  <p className={cn('text-xl font-bold', kpi.positive ? 'text-green-600' : 'text-red-500')}>
                    {fmtMoney(kpi.value)}
                  </p>
                  <p className="text-xs text-gray-500">{kpi.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Transactions table */}
          <div className="apple-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Tarih</th>
                    <th className="px-4 py-3 text-left font-medium">Açıklama</th>
                    <th className="px-4 py-3 text-left font-medium">Tür</th>
                    <th className="px-4 py-3 text-right font-medium">Tutar</th>
                    <th className="px-4 py-3 text-left font-medium">Belge No</th>
                    <th className="px-4 py-3 text-left font-medium">Kasa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {hareketler.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                        Henüz hareket kaydı yok.
                      </td>
                    </tr>
                  ) : (
                    hareketler.map(h => (
                      <tr key={h.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-500">{h.tarih}</td>
                        <td className="px-4 py-3 text-gray-700 font-medium">{h.aciklama}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold',
                            h.tur === 'Giriş' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          )}>
                            {h.tur === 'Giriş' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                            {h.tur}
                          </span>
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right font-bold',
                          h.tur === 'Giriş' ? 'text-green-600' : 'text-red-500'
                        )}>
                          {h.tur === 'Çıkış' ? '-' : '+'}{fmtMoney(h.tutar)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{h.belgeNo || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{h.kasaAd}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Günlük Kapanış ── */}
      {activeTab === 'kapanis' && (
        <div className="space-y-4">
          {/* Today summary */}
          <div className="apple-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Bugün — {TODAY}</h3>
              {alreadyClosedToday ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                  <CheckCircle size={13} /> Gün Kapatıldı
                </span>
              ) : (
                <button onClick={handleGunuKapat} className="apple-button-primary flex items-center gap-1.5 px-4 py-2 text-sm">
                  <Lock size={14} />
                  Günü Kapat
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Açılış Bakiyesi', value: kapanislar[0]?.kapanisBakiye ?? 0, color: 'text-gray-700' },
                { label: 'Toplam Giriş', value: bugunGiris, color: 'text-green-600' },
                { label: 'Toplam Çıkış', value: bugunCikis, color: 'text-red-500' },
                {
                  label: 'Kapanış Bakiyesi',
                  value: (kapanislar[0]?.kapanisBakiye ?? 0) + bugunGiris - bugunCikis,
                  color: toplamBakiye >= 0 ? 'text-green-600' : 'text-red-500',
                },
              ].map(s => (
                <div key={s.label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                  <p className={cn('text-lg font-bold', s.color)}>{fmtMoney(s.value)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Past closings table */}
          <div className="apple-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h4 className="font-medium text-gray-800 text-sm">Geçmiş Kapanışlar</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Tarih</th>
                    <th className="px-4 py-3 text-right font-medium">Açılış</th>
                    <th className="px-4 py-3 text-right font-medium">Girişler</th>
                    <th className="px-4 py-3 text-right font-medium">Çıkışlar</th>
                    <th className="px-4 py-3 text-right font-medium">Kapanış</th>
                    <th className="px-4 py-3 text-left font-medium">Kapatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {kapanislar.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                        Henüz kapanış kaydı yok.
                      </td>
                    </tr>
                  ) : (
                    kapanislar.map(k => (
                      <tr key={k.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{k.tarih}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{fmtMoney(k.acilisBakiye)}</td>
                        <td className="px-4 py-3 text-right text-green-600 font-semibold">+{fmtMoney(k.toplamGiris)}</td>
                        <td className="px-4 py-3 text-right text-red-500 font-semibold">-{fmtMoney(k.toplamCikis)}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900">{fmtMoney(k.kapanisBakiye)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{k.kapatan}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Kasalar ── */}
      {activeTab === 'kasalar' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => openKasaModal()} className="apple-button-primary flex items-center gap-1.5 px-4 py-2 text-sm">
              <Plus size={15} />
              Yeni Kasa
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {kasalar.length === 0 ? (
              <div className="col-span-3 apple-card p-10 text-center text-gray-400">
                Henüz kasa tanımı yok.
              </div>
            ) : (
              kasalar.map(kasa => {
                const bakiye = kasaBakiye[kasa.id] ?? 0;
                const sym = DOVIZ_SYMBOL[kasa.doviz];
                return (
                  <div key={kasa.id} className="apple-card p-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{kasa.ad}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{kasa.sorumlu || 'Sorumlu atanmamış'}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          kasa.durum === 'Aktif' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        )}>
                          {kasa.durum}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {kasa.doviz}
                        </span>
                      </div>
                    </div>
                    <div className={cn(
                      'rounded-xl p-3 text-center',
                      bakiye >= 0 ? 'bg-green-50' : 'bg-red-50'
                    )}>
                      <p className="text-xs text-gray-500 mb-0.5">Güncel Bakiye</p>
                      <p className={cn('text-xl font-bold', bakiye >= 0 ? 'text-green-600' : 'text-red-500')}>
                        {fmtMoney(bakiye, sym)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openKasaModal(kasa)}
                        className="flex-1 apple-button-secondary py-2 text-xs flex items-center justify-center gap-1"
                      >
                        <Edit2 size={12} /> Düzenle
                      </button>
                      {deletingKasa === kasa.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleDeleteKasa(kasa.id)} className="px-3 py-2 bg-red-600 text-white rounded-xl text-xs">Evet</button>
                          <button onClick={() => setDeletingKasa(null)} className="px-3 py-2 bg-gray-200 text-gray-700 rounded-xl text-xs">Hayır</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingKasa(kasa.id)}
                          className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── Hareket Modal ── */}
      <AnimatePresence>
        {showHareketModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setShowHareketModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Yeni Kasa Hareketi</h3>
                <button onClick={() => setShowHareketModal(false)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Kasa select */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Kasa <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select
                      className="apple-input w-full px-3 py-2.5 text-sm appearance-none pr-8"
                      value={hForm.kasaId}
                      onChange={e => setHForm(f => ({ ...f, kasaId: e.target.value }))}
                    >
                      <option value="">Kasa seçin...</option>
                      {kasalar.filter(k => k.durum === 'Aktif').map(k => (
                        <option key={k.id} value={k.id}>{k.ad}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  {kasalar.filter(k => k.durum === 'Aktif').length === 0 && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Önce "Kasalar" sekmesinde aktif kasa tanımlayın.
                    </p>
                  )}
                </div>

                {/* Tür toggle */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Hareket Türü</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['Giriş', 'Çıkış'] as HareketTur[]).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setHForm(f => ({ ...f, tur: t }))}
                        className={cn(
                          'py-2.5 rounded-xl text-sm font-medium border-2 transition-all',
                          hForm.tur === t
                            ? t === 'Giriş' ? 'border-green-500 bg-green-50 text-green-700' : 'border-red-500 bg-red-50 text-red-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        )}
                      >
                        {t === 'Giriş'
                          ? <TrendingUp size={14} className="inline mr-1" />
                          : <TrendingDown size={14} className="inline mr-1" />}
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tutar */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Tutar <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    className="apple-input w-full px-3 py-2.5 text-sm"
                    value={hForm.tutar}
                    onChange={e => setHForm(f => ({ ...f, tutar: e.target.value }))}
                    placeholder="0,00"
                    min={0}
                  />
                </div>

                {/* Açıklama */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Açıklama <span className="text-red-500">*</span></label>
                  <input
                    className="apple-input w-full px-3 py-2.5 text-sm"
                    value={hForm.aciklama}
                    onChange={e => setHForm(f => ({ ...f, aciklama: e.target.value }))}
                    placeholder="Hareket açıklaması..."
                  />
                </div>

                {/* Belge No + Tarih */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Belge No</label>
                    <input
                      className="apple-input w-full px-3 py-2.5 text-sm font-mono"
                      value={hForm.belgeNo}
                      onChange={e => setHForm(f => ({ ...f, belgeNo: e.target.value }))}
                      placeholder="Opsiyonel"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Tarih</label>
                    <input
                      type="date"
                      className="apple-input w-full px-3 py-2.5 text-sm"
                      value={hForm.tarih}
                      onChange={e => setHForm(f => ({ ...f, tarih: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
                <button onClick={() => setShowHareketModal(false)} className="apple-button-secondary px-5 py-2 text-sm">İptal</button>
                <button onClick={handleSaveHareket} className="apple-button-primary px-5 py-2 text-sm">Kaydet</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Kasa CRUD Modal ── */}
      <AnimatePresence>
        {showKasaModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setShowKasaModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">{editingKasa ? 'Kasa Düzenle' : 'Yeni Kasa'}</h3>
                <button onClick={() => setShowKasaModal(false)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Kasa Adı <span className="text-red-500">*</span></label>
                  <input
                    className="apple-input w-full px-3 py-2.5 text-sm"
                    value={kForm.ad}
                    onChange={e => setKForm(f => ({ ...f, ad: e.target.value }))}
                    placeholder="Örn: Ana Kasa, Döviz Kasası"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Döviz</label>
                  <div className="relative">
                    <select
                      className="apple-input w-full px-3 py-2.5 text-sm appearance-none pr-8"
                      value={kForm.doviz}
                      onChange={e => setKForm(f => ({ ...f, doviz: e.target.value as KasaDoviz }))}
                    >
                      {(['TRY', 'USD', 'EUR'] as KasaDoviz[]).map(d => (
                        <option key={d} value={d}>{d} — {DOVIZ_SYMBOL[d]}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Sorumlu</label>
                  <input
                    className="apple-input w-full px-3 py-2.5 text-sm"
                    value={kForm.sorumlu}
                    onChange={e => setKForm(f => ({ ...f, sorumlu: e.target.value }))}
                    placeholder="Ad Soyad"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Durum</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['Aktif', 'Pasif'] as KasaDurum[]).map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setKForm(f => ({ ...f, durum: d }))}
                        className={cn(
                          'py-2 rounded-xl text-sm font-medium border-2 transition-all',
                          kForm.durum === d
                            ? d === 'Aktif' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-400 bg-gray-100 text-gray-600'
                            : 'border-gray-200 text-gray-400 hover:border-gray-300'
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
                <button onClick={() => setShowKasaModal(false)} className="apple-button-secondary px-5 py-2 text-sm">İptal</button>
                <button onClick={handleSaveKasa} className="apple-button-primary px-5 py-2 text-sm">Kaydet</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
