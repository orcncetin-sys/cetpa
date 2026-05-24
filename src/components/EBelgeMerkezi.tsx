import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Send, AlertTriangle, Clock, Plus, X, RefreshCw,
  CheckCircle, XCircle, Wifi, Search, Trash2, ChevronDown
} from 'lucide-react';
import { db } from '../firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, setDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

type BelgeTur = 'e-fatura' | 'e-arsiv' | 'e-irsaliye' | 'e-smm';
type BelgeDurum = 'Gönderildi' | 'Bekliyor' | 'Hata' | 'İptal';

interface EBelge {
  id: string;
  belgeNo: string;
  alici: string;
  vergiNo: string;
  tutar: number;
  belgeDate: string;
  tur: BelgeTur;
  durum: BelgeDurum;
  notes: string;
  createdAt?: unknown;
}

interface EBelgeMerkeziProps {
  currentLanguage: string;
  isAuthenticated: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const cn = (...classes: unknown[]) => classes.filter(Boolean).join(' ');

function generateBelgeNo(tur: BelgeTur, existingBelgeler: { belgeNo: string; tur: BelgeTur }[]): string {
  const prefix: Record<BelgeTur, string> = {
    'e-fatura': 'EF',
    'e-arsiv': 'EA',
    'e-irsaliye': 'EI',
    'e-smm': 'ES',
  };
  const year = new Date().getFullYear();
  const yearPrefix = `${prefix[tur]}-${year}-`;
  // Find highest sequence number for this type in the current year
  const existing = existingBelgeler
    .filter(b => b.tur === tur && b.belgeNo.startsWith(yearPrefix))
    .map(b => parseInt(b.belgeNo.replace(yearPrefix, ''), 10))
    .filter(n => !isNaN(n));
  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${yearPrefix}${String(next).padStart(4, '0')}`;
}

const TUR_LABELS: Record<BelgeTur, string> = {
  'e-fatura': 'E-Fatura',
  'e-arsiv': 'E-Arşiv',
  'e-irsaliye': 'E-İrsaliye',
  'e-smm': 'E-SMM',
};

const DURUM_CONFIG: Record<BelgeDurum, { label: string; color: string; icon: React.ReactNode }> = {
  Gönderildi: {
    label: 'Gönderildi',
    color: 'bg-green-100 text-green-700',
    icon: <CheckCircle size={12} />,
  },
  Bekliyor: {
    label: 'Bekliyor',
    color: 'bg-amber-100 text-amber-700',
    icon: <Clock size={12} />,
  },
  Hata: {
    label: 'Hata',
    color: 'bg-red-100 text-red-700',
    icon: <AlertTriangle size={12} />,
  },
  İptal: {
    label: 'İptal',
    color: 'bg-gray-100 text-gray-500',
    icon: <XCircle size={12} />,
  },
};

const SUB_TABS: { key: BelgeTur; label: string }[] = [
  { key: 'e-fatura', label: 'E-Fatura' },
  { key: 'e-arsiv', label: 'E-Arşiv' },
  { key: 'e-irsaliye', label: 'E-İrsaliye' },
  { key: 'e-smm', label: 'E-SMM' },
];

// ─── Toast ────────────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const show = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };
  return { toast, show };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EBelgeMerkezi({ isAuthenticated }: EBelgeMerkeziProps) {
  const [activeTab, setActiveTab] = useState<BelgeTur>('e-fatura');
  const [belgeler, setBelgeler] = useState<EBelge[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast, show: showToast } = useToast();

  // GIB connection — live from Firestore settings/gib
  const [gibConnected, setGibConnected] = useState(false);
  const [gibLastCheck, setGibLastCheck] = useState<Date | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'gib'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setGibConnected(d.connected ?? false);
        setGibLastCheck(d.lastCheck?.toDate?.() ?? null);
      } else {
        setGibConnected(false);
        setGibLastCheck(null);
      }
    });
    return unsub;
  }, []);

  const toggleGib = async () => {
    await setDoc(doc(db, 'settings', 'gib'), {
      connected: !gibConnected,
      lastCheck: serverTimestamp(),
    }, { merge: true });
  };

  // Form state
  const [form, setForm] = useState({
    belgeNo: '',
    alici: '',
    vergiNo: '',
    tutar: '',
    belgeDate: new Date().toISOString().split('T')[0],
    tur: 'e-fatura' as BelgeTur,
    durum: 'Bekliyor' as BelgeDurum,
    notes: '',
  });

  // Firestore listener
  useEffect(() => {
    if (!isAuthenticated) return;
    const q = query(collection(db, 'eBelgeler'), orderBy('belgeDate', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setBelgeler(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<EBelge, 'id'>) })));
    });
    return unsub;
  }, [isAuthenticated]);

  const openModal = () => {
    setForm({
      belgeNo: generateBelgeNo(activeTab, belgeler),
      alici: '',
      vergiNo: '',
      tutar: '',
      belgeDate: new Date().toISOString().split('T')[0],
      tur: activeTab,
      durum: 'Bekliyor',
      notes: '',
    });
    setShowModal(true);
  };

  const handleTurChange = (tur: BelgeTur) => {
    setForm(f => ({ ...f, tur, belgeNo: generateBelgeNo(tur, belgeler) }));
  };

  const handleSave = async () => {
    if (!form.belgeNo || !form.alici || !form.tutar) {
      showToast('Lütfen zorunlu alanları doldurun.', 'error');
      return;
    }
    try {
      await addDoc(collection(db, 'eBelgeler'), {
        ...form,
        tutar: parseFloat(form.tutar) || 0,
        createdAt: serverTimestamp(),
      });
      showToast(`${TUR_LABELS[form.tur]} belgesi oluşturuldu.`);
      setShowModal(false);
    } catch {
      showToast('Belge kaydedilemedi.', 'error');
    }
  };

  const handleResend = async (belge: EBelge) => {
    try {
      await updateDoc(doc(db, 'eBelgeler', belge.id), { durum: 'Gönderildi' });
      showToast(`${belge.belgeNo} yeniden gönderildi.`);
    } catch {
      showToast('İşlem başarısız.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'eBelgeler', id));
      showToast('Belge silindi.');
    } catch {
      showToast('Silme başarısız.', 'error');
    } finally {
      setDeleting(null);
    }
  };

  const filtered = belgeler.filter(b => {
    const matchesTab = b.tur === activeTab;
    const matchesSearch =
      !search ||
      b.belgeNo.toLowerCase().includes(search.toLowerCase()) ||
      b.alici.toLowerCase().includes(search.toLowerCase()) ||
      b.vergiNo.includes(search);
    return matchesTab && matchesSearch;
  });

  // KPI counts — all docs (not just active tab)
  const toplam = belgeler.length;
  const gonderilen = belgeler.filter(b => b.durum === 'Gönderildi').length;
  const hata = belgeler.filter(b => b.durum === 'Hata').length;
  const bekleyen = belgeler.filter(b => b.durum === 'Bekliyor').length;

  const fmt = (n: number) =>
    n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Toplam Belge', value: toplam, icon: <FileText size={16} />, color: 'text-blue-600 bg-blue-50' },
          { label: 'Gönderilen', value: gonderilen, icon: <Send size={16} />, color: 'text-green-600 bg-green-50' },
          { label: 'Hata / Red', value: hata, icon: <AlertTriangle size={16} />, color: 'text-red-600 bg-red-50' },
          { label: 'Bekleyen', value: bekleyen, icon: <Clock size={16} />, color: 'text-amber-600 bg-amber-50' },
        ].map(kpi => (
          <div key={kpi.label} className="apple-card p-4 flex items-center gap-3">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', kpi.color)}>
              {kpi.icon}
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{kpi.value}</p>
              <p className="text-xs text-gray-500">{kpi.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Sub-tabs + Actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="overflow-x-auto scrollbar-none">
          <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
            {SUB_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${activeTab === tab.key ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {/* GIB status + add button */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={isAuthenticated ? toggleGib : undefined}
            title={isAuthenticated ? (gibConnected ? 'Bağlantıyı kes' : 'GIB bağlantısını etkinleştir') : undefined}
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-full transition-colors ${gibConnected ? 'bg-green-50 border-green-200 hover:bg-green-100' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'} ${isAuthenticated ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${gibConnected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
            <Wifi size={12} className={gibConnected ? 'text-green-600' : 'text-gray-400'} />
            <span className={`text-xs font-medium ${gibConnected ? 'text-green-700' : 'text-gray-500'}`}>
              {gibConnected ? 'GIB Bağlı' : 'GIB Bağlı Değil'}
            </span>
            {gibLastCheck && <span className="text-[10px] text-gray-400 hidden sm:inline">{gibLastCheck.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>}
          </button>
          <button onClick={openModal} className="apple-button-primary flex items-center gap-1.5 px-4 py-2 text-sm">
            <Plus size={15} />
            Yeni Belge
          </button>
        </div>
      </div>

      {/* Table card */}
      <div className="apple-card overflow-hidden">
        {/* Search bar */}
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="apple-input w-full pl-9 pr-3 py-2 text-sm"
              placeholder="Belge no, alıcı veya vergi no ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span className="text-xs text-gray-400">{filtered.length} kayıt</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">Belge No</th>
                <th className="px-4 py-3 text-left font-medium">Alıcı / Gönderici</th>
                <th className="px-4 py-3 text-left font-medium">Vergi No</th>
                <th className="px-4 py-3 text-right font-medium">Tutar (₺)</th>
                <th className="px-4 py-3 text-left font-medium">Tarih</th>
                <th className="px-4 py-3 text-left font-medium">Tür</th>
                <th className="px-4 py-3 text-left font-medium">Durum</th>
                <th className="px-4 py-3 text-center font-medium">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">
                    Bu kategoride henüz belge yok.
                  </td>
                </tr>
              ) : (
                filtered.map(belge => {
                  const dur = DURUM_CONFIG[belge.durum];
                  const canResend = belge.durum === 'Hata' || belge.durum === 'Bekliyor';
                  return (
                    <tr key={belge.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-800">{belge.belgeNo}</td>
                      <td className="px-4 py-3 text-gray-700 font-medium">{belge.alici}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{belge.vergiNo || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(belge.tutar)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{belge.belgeDate}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium">
                          {TUR_LABELS[belge.tur]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium', dur.color)}>
                          {dur.icon}
                          {dur.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          {canResend && (
                            <button
                              onClick={() => handleResend(belge)}
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                              title="Yeniden Gönder"
                            >
                              <RefreshCw size={14} />
                            </button>
                          )}
                          {deleting === belge.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(belge.id)}
                                className="px-2 py-1 bg-red-600 text-white rounded-lg text-xs"
                              >
                                Evet
                              </button>
                              <button
                                onClick={() => setDeleting(null)}
                                className="px-2 py-1 bg-gray-200 text-gray-700 rounded-lg text-xs"
                              >
                                Hayır
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleting(belge.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Document Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Yeni E-Belge Ekle</h3>
                <button onClick={() => setShowModal(false)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Tur */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Belge Türü</label>
                  <div className="relative">
                    <select
                      className="apple-input w-full px-3 py-2.5 text-sm appearance-none pr-8"
                      value={form.tur}
                      onChange={e => handleTurChange(e.target.value as BelgeTur)}
                    >
                      {SUB_TABS.map(t => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Belge No */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Belge No</label>
                  <input
                    className="apple-input w-full px-3 py-2.5 text-sm font-mono"
                    value={form.belgeNo}
                    onChange={e => setForm(f => ({ ...f, belgeNo: e.target.value }))}
                    placeholder="Otomatik oluşturulur"
                  />
                </div>

                {/* Alıcı */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Alıcı / Gönderici <span className="text-red-500">*</span></label>
                  <input
                    className="apple-input w-full px-3 py-2.5 text-sm"
                    value={form.alici}
                    onChange={e => setForm(f => ({ ...f, alici: e.target.value }))}
                    placeholder="Müşteri / firma adı"
                  />
                </div>

                {/* Vergi No */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Vergi No</label>
                  <input
                    className="apple-input w-full px-3 py-2.5 text-sm font-mono"
                    value={form.vergiNo}
                    onChange={e => setForm(f => ({ ...f, vergiNo: e.target.value }))}
                    placeholder="10 haneli vergi numarası"
                    maxLength={11}
                  />
                </div>

                {/* Tutar + Tarih */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Tutar (₺) <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      className="apple-input w-full px-3 py-2.5 text-sm"
                      value={form.tutar}
                      onChange={e => setForm(f => ({ ...f, tutar: e.target.value }))}
                      placeholder="0,00"
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Belge Tarihi</label>
                    <input
                      type="date"
                      className="apple-input w-full px-3 py-2.5 text-sm"
                      value={form.belgeDate}
                      onChange={e => setForm(f => ({ ...f, belgeDate: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Durum */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Durum</label>
                  <div className="relative">
                    <select
                      className="apple-input w-full px-3 py-2.5 text-sm appearance-none pr-8"
                      value={form.durum}
                      onChange={e => setForm(f => ({ ...f, durum: e.target.value as BelgeDurum }))}
                    >
                      {(['Bekliyor', 'Gönderildi', 'Hata', 'İptal'] as BelgeDurum[]).map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Notlar */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Notlar</label>
                  <textarea
                    className="apple-input w-full px-3 py-2.5 text-sm resize-none"
                    rows={2}
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="İsteğe bağlı not..."
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
                <button onClick={() => setShowModal(false)} className="apple-button-secondary px-5 py-2 text-sm">
                  İptal
                </button>
                <button onClick={handleSave} className="apple-button-primary px-5 py-2 text-sm">
                  Kaydet
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
