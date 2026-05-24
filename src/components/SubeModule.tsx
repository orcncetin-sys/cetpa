import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc,
  doc, serverTimestamp, query, orderBy, where, limit
} from 'firebase/firestore';
import { db } from '../firebase';
import { sortByCreatedAt } from '../utils/fsSort';
import {
  Building2, ArrowRightLeft, BarChart3, Plus, X,
  MapPin, Phone, Mail, User, CheckCircle, Clock, Package
} from 'lucide-react';

interface Sube {
  id: string;
  subeKodu: string;
  subeAdi: string;
  sehir: string;
  adres: string;
  yonetici: string;
  telefon: string;
  email: string;
  durum: 'Aktif' | 'Pasif';
  acilisTarihi: string;
  calisanSayisi: number;
  createdAt?: any;
}

interface SubeTransfer {
  id: string;
  transferNo: string;
  kaynakSube: string;
  hedefSube: string;
  urun: string;
  miktar: number;
  transferTarihi: string;
  durum: 'Bekliyor' | 'Onaylandı' | 'Teslim Edildi';
  notlar: string;
  createdAt?: any;
}


function statusBadge(durum: string) {
  const map: Record<string, string> = {
    'Aktif': 'bg-green-100 text-green-700',
    'Pasif': 'bg-gray-100 text-gray-500',
    'Bekliyor': 'bg-amber-100 text-amber-700',
    'Onaylandı': 'bg-blue-100 text-blue-700',
    'Teslim Edildi': 'bg-green-100 text-green-700',
  };
  return `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[durum] ?? 'bg-gray-100 text-gray-600'}`;
}

export default function SubeModule({ currentLanguage, isAuthenticated }: { currentLanguage: string; isAuthenticated: boolean }) {
  const [activeTab, setActiveTab] = useState<'subeler' | 'transfer' | 'pl'>('subeler');
  const [subeler, setSubeler] = useState<Sube[]>([]);
  const [transferler, setTransferler] = useState<SubeTransfer[]>([]);
  const [showSubeModal, setShowSubeModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [editingSube, setEditingSube] = useState<Sube | null>(null);
  const [saving, setSaving] = useState(false);

  type PLOrder = { subeAdi?: string; totalPrice?: number; costTotal?: number; status?: string; createdAt?: unknown };
  const [plOrders, setPlOrders] = useState<PLOrder[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'orders'), limit(2000)),
      snap => setPlOrders(sortByCreatedAt(snap.docs.map(d => d.data() as PLOrder)))
    );
    return unsub;
  }, []);

  const emptySube: Omit<Sube, 'id'> = { subeKodu: '', subeAdi: '', sehir: '', adres: '', yonetici: '', telefon: '', email: '', durum: 'Aktif', acilisTarihi: '', calisanSayisi: 0, createdAt: null };
  const [subeForm, setSubeForm] = useState<Omit<Sube, 'id'>>(emptySube);

  const emptyTransfer = { kaynakSube: '', hedefSube: '', urun: '', miktar: '', transferTarihi: '', notlar: '' };
  const [transferForm, setTransferForm] = useState(emptyTransfer);

  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'subeler')), snap =>
        setSubeler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Sube))))),
      onSnapshot(query(collection(db, 'subeTransferler')), snap =>
        setTransferler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as SubeTransfer))))),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  function openEditSube(sube: Sube) {
    const { id, ...rest } = sube;
    setSubeForm(rest);
    setEditingSube(sube);
    setShowSubeModal(true);
  }

  async function saveSube() {
    if (!subeForm.subeAdi || !subeForm.sehir) return;
    setSaving(true);
    if (editingSube) {
      await updateDoc(doc(db, 'subeler', editingSube.id), { ...subeForm });
    } else {
      await addDoc(collection(db, 'subeler'), { ...subeForm, createdAt: serverTimestamp() });
    }
    setSubeForm(emptySube);
    setEditingSube(null);
    setShowSubeModal(false);
    setSaving(false);
  }

  async function saveTransfer() {
    if (!transferForm.kaynakSube || !transferForm.hedefSube || !transferForm.urun) return;
    setSaving(true);
    const no = `TR-2026-${String(transferler.length + 1).padStart(4, '0')}`;
    await addDoc(collection(db, 'subeTransferler'), {
      ...transferForm,
      transferNo: no,
      miktar: Number(transferForm.miktar),
      durum: 'Bekliyor',
      createdAt: serverTimestamp(),
    });
    setTransferForm(emptyTransfer);
    setShowTransferModal(false);
    setSaving(false);
  }

  async function approveTransfer(id: string) {
    await updateDoc(doc(db, 'subeTransferler', id), { durum: 'Onaylandı' });
  }

  async function deliverTransfer(id: string) {
    await updateDoc(doc(db, 'subeTransferler', id), { durum: 'Teslim Edildi' });
  }

  const aktifCount = subeler.filter(s => s.durum === 'Aktif').length;
  const pasifCount = subeler.filter(s => s.durum === 'Pasif').length;
  const subeNames = subeler.map(s => s.subeAdi);

  const tabs = [
    { key: 'subeler', label: 'Şubeler', icon: Building2 },
    { key: 'transfer', label: 'Şubeler Arası Transfer', icon: ArrowRightLeft },
    { key: 'pl', label: 'Şube P&L', icon: BarChart3 },
  ] as const;

  // Computed P&L from real orders
  const now = new Date();
  const tmYear = now.getFullYear(), tmMonth = now.getMonth();
  const lmYear = tmMonth === 0 ? tmYear - 1 : tmYear;
  const lmMonth = tmMonth === 0 ? 11 : tmMonth - 1;

  function toDate(v: unknown): Date | null {
    if (!v) return null;
    if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
    try { return new Date(v as string); } catch { return null; }
  }

  const computedPL = subeler.map(s => {
    const bOrders = plOrders.filter(o => o.subeAdi === s.subeAdi && o.status !== 'Cancelled');
    const tmo = bOrders.filter(o => { const d = toDate(o.createdAt); return d && d.getFullYear() === tmYear && d.getMonth() === tmMonth; });
    const lmo = bOrders.filter(o => { const d = toDate(o.createdAt); return d && d.getFullYear() === lmYear && d.getMonth() === lmMonth; });
    const buAyGelir     = tmo.reduce((s, o) => s + (o.totalPrice ?? 0), 0);
    const gecenAyGelir  = lmo.reduce((s, o) => s + (o.totalPrice ?? 0), 0);
    const buAyMaliyet   = tmo.reduce((s, o) => s + (o.costTotal ?? (o.totalPrice ?? 0) * 0.65), 0);
    const gecenAyMaliyet = lmo.reduce((s, o) => s + (o.costTotal ?? (o.totalPrice ?? 0) * 0.65), 0);
    return { subeAdi: s.subeAdi, buAyGelir, buAyMaliyet, gecenAyGelir, gecenAyMaliyet };
  });
  const plHasData = computedPL.some(p => p.buAyGelir > 0 || p.gecenAyGelir > 0);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      {activeTab === 'subeler' && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Toplam Şube', value: subeler.length, color: 'text-gray-900' },
            { label: 'Aktif', value: aktifCount, color: 'text-green-600' },
            { label: 'Pasif', value: pasifCount, color: 'text-gray-400' },
          ].map(k => (
            <div key={k.label} className="apple-card text-center">
              <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-gray-500 mt-1">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + Add */}
      <div className="flex items-center justify-between">
        <div className="overflow-x-auto scrollbar-none">
          <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${activeTab === t.key ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}
              >
                <t.icon className="w-3 h-3" /> {t.label}
              </button>
            ))}
          </div>
        </div>
        {activeTab !== 'pl' && (
          <button
            onClick={() => { activeTab === 'transfer' ? setShowTransferModal(true) : (setEditingSube(null), setSubeForm(emptySube), setShowSubeModal(true)); }}
            className="apple-button-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> {activeTab === 'transfer' ? 'Yeni Transfer' : 'Yeni Şube'}
          </button>
        )}
      </div>

      {/* Şubeler Tab */}
      {activeTab === 'subeler' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {subeler.length === 0 && (
            <div className="apple-card col-span-3 text-center py-16 text-gray-400">
              <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Henüz şube kaydı yok</p>
            </div>
          )}
          {subeler.map(s => (
            <div key={s.id} className="apple-card hover:shadow-md transition-shadow cursor-pointer" onClick={() => openEditSube(s)}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-brand font-bold">{s.subeKodu}</span>
                    <span className={statusBadge(s.durum)}>{s.durum}</span>
                  </div>
                  <h3 className="text-base font-bold text-gray-900 mt-0.5">{s.subeAdi}</h3>
                </div>
                <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-brand" />
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-gray-500">
                <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3" /> {s.sehir}{s.adres ? ` — ${s.adres}` : ''}</div>
                {s.yonetici && <div className="flex items-center gap-1.5"><User className="w-3 h-3" /> {s.yonetici}</div>}
                {s.telefon && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {s.telefon}</div>}
                {s.email && <div className="flex items-center gap-1.5"><Mail className="w-3 h-3" /> {s.email}</div>}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">{transferler.filter(t => t.kaynakSube === s.subeAdi || t.hedefSube === s.subeAdi).length}</p>
                  <p className="text-xs text-gray-400">Transfer</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">{s.calisanSayisi || 0}</p>
                  <p className="text-xs text-gray-400">Çalışan</p>
                </div>
              </div>
              {s.acilisTarihi && <p className="text-xs text-gray-400 mt-2">Açılış: {s.acilisTarihi}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Transfer Tab */}
      {activeTab === 'transfer' && (
        <div className="apple-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Transfer No', 'Kaynak Şube', 'Hedef Şube', 'Ürün', 'Miktar', 'Tarih', 'Durum', 'İşlem'].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transferler.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">Henüz transfer kaydı yok</td></tr>
              )}
              {transferler.map(t => (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-3 font-mono text-xs text-brand font-semibold">{t.transferNo}</td>
                  <td className="py-3 px-3 text-gray-700">{t.kaynakSube}</td>
                  <td className="py-3 px-3 text-gray-700">{t.hedefSube}</td>
                  <td className="py-3 px-3 text-gray-600">{t.urun}</td>
                  <td className="py-3 px-3 text-gray-600">{t.miktar}</td>
                  <td className="py-3 px-3 text-gray-500 whitespace-nowrap">{t.transferTarihi}</td>
                  <td className="py-3 px-3"><span className={statusBadge(t.durum)}>{t.durum}</span></td>
                  <td className="py-3 px-3">
                    {t.durum === 'Bekliyor' && (
                      <button onClick={() => approveTransfer(t.id)} className="apple-button-secondary text-xs py-1 px-3 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-600" /> Onayla
                      </button>
                    )}
                    {t.durum === 'Onaylandı' && (
                      <button onClick={() => deliverTransfer(t.id)} className="apple-button-secondary text-xs py-1 px-3 flex items-center gap-1">
                        <Package className="w-3 h-3 text-blue-600" /> Teslim Et
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* P&L Tab */}
      {activeTab === 'pl' && (
        <div className="space-y-4">
          <div className="apple-card p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-4">Şube Kâr-Zarar Karşılaştırması</h3>
            {!plHasData && (
              <div className="apple-card p-6 text-center text-gray-400">
                <p className="text-sm font-medium mb-1">{currentLanguage === 'tr' ? 'Henüz şube bazlı sipariş yok' : 'No branch-tagged orders yet'}</p>
                <p className="text-xs">{currentLanguage === 'tr' ? 'Sipariş oluştururken şube seçin — veriler burada görünür.' : 'Select a branch when creating orders — data will appear here.'}</p>
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '560px' }}>
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Şube</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Bu Ay Gelir</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Bu Ay Maliyet</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-green-600">Bu Ay Kâr</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Marj %</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400">Geçen Ay Kâr</th>
                </tr>
              </thead>
              <tbody>
                {computedPL.map(row => {
                  const buAyKar = row.buAyGelir - row.buAyMaliyet;
                  const gecenAyKar = row.gecenAyGelir - row.gecenAyMaliyet;
                  const marj = Math.round((buAyKar / row.buAyGelir) * 100);
                  const trend = buAyKar >= gecenAyKar;
                  return (
                    <tr key={row.subeAdi} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-3 font-semibold text-gray-900">{row.subeAdi}</td>
                      <td className="py-3 px-3 text-right text-gray-700">₺ {row.buAyGelir.toLocaleString()}</td>
                      <td className="py-3 px-3 text-right text-gray-500">₺ {row.buAyMaliyet.toLocaleString()}</td>
                      <td className="py-3 px-3 text-right font-bold text-green-600">₺ {buAyKar.toLocaleString()}</td>
                      <td className="py-3 px-3 text-right">
                        <span className={`text-sm font-bold ${marj >= 35 ? 'text-green-600' : marj >= 25 ? 'text-amber-600' : 'text-red-500'}`}>{marj}%</span>
                      </td>
                      <td className="py-3 px-3 text-right text-gray-400">
                        <span className={trend ? 'text-green-500' : 'text-red-400'}>{trend ? '▲' : '▼'}</span>
                        {' '}₺ {gecenAyKar.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          {/* CSS Bar Chart */}
          <div className="apple-card p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-4">Şube Gelir Karşılaştırması (Bu Ay)</h3>
            <div className="space-y-3">
              {computedPL.map(row => {
                const maxGelir = Math.max(...computedPL.map(r => r.buAyGelir), 1);
                const pct = Math.round((row.buAyGelir / maxGelir) * 100);
                const karPct = Math.round(((row.buAyGelir - row.buAyMaliyet) / row.buAyGelir) * 100);
                return (
                  <div key={row.subeAdi}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-700">{row.subeAdi}</span>
                      <span className="text-xs text-gray-500">₺ {row.buAyGelir.toLocaleString()} <span className="text-green-600 font-semibold">({karPct}% marj)</span></span>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Şube Modal */}
      {showSubeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">{editingSube ? 'Şubeyi Düzenle' : 'Yeni Şube'}</h3>
              <button onClick={() => setShowSubeModal(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Şube Kodu *', key: 'subeKodu' },
                  { label: 'Şube Adı *', key: 'subeAdi' },
                  { label: 'Şehir *', key: 'sehir' },
                  { label: 'Yönetici', key: 'yonetici' },
                  { label: 'Telefon', key: 'telefon' },
                  { label: 'E-posta', key: 'email' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                    <input value={(subeForm as any)[f.key]} onChange={e => setSubeForm(p => ({ ...p, [f.key]: e.target.value }))} className="apple-input" />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Adres</label>
                <input value={subeForm.adres} onChange={e => setSubeForm(p => ({ ...p, adres: e.target.value }))} className="apple-input" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Durum</label>
                  <select value={subeForm.durum} onChange={e => setSubeForm(p => ({ ...p, durum: e.target.value as any }))} className="apple-input">
                    <option>Aktif</option><option>Pasif</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Çalışan Sayısı</label>
                  <input type="number" value={subeForm.calisanSayisi} onChange={e => setSubeForm(p => ({ ...p, calisanSayisi: Number(e.target.value) }))} className="apple-input" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Açılış Tarihi</label>
                  <input type="date" value={subeForm.acilisTarihi} onChange={e => setSubeForm(p => ({ ...p, acilisTarihi: e.target.value }))} className="apple-input" />
                </div>
              </div>
              <button onClick={saveSube} disabled={saving} className="apple-button-primary w-full">{saving ? 'Kaydediliyor...' : editingSube ? 'Güncelle' : 'Kaydet'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Yeni Şubeler Arası Transfer</h3>
              <button onClick={() => setShowTransferModal(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Kaynak Şube *</label>
                  <select value={transferForm.kaynakSube} onChange={e => setTransferForm(p => ({ ...p, kaynakSube: e.target.value }))} className="apple-input">
                    <option value="">Seçiniz</option>
                    {subeNames.map(n => <option key={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Hedef Şube *</label>
                  <select value={transferForm.hedefSube} onChange={e => setTransferForm(p => ({ ...p, hedefSube: e.target.value }))} className="apple-input">
                    <option value="">Seçiniz</option>
                    {subeNames.filter(n => n !== transferForm.kaynakSube).map(n => <option key={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Ürün *</label>
                <input value={transferForm.urun} onChange={e => setTransferForm(p => ({ ...p, urun: e.target.value }))} className="apple-input" placeholder="Ürün adı veya kodu" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Miktar</label>
                  <input type="number" value={transferForm.miktar} onChange={e => setTransferForm(p => ({ ...p, miktar: e.target.value }))} className="apple-input" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Transfer Tarihi</label>
                  <input type="date" value={transferForm.transferTarihi} onChange={e => setTransferForm(p => ({ ...p, transferTarihi: e.target.value }))} className="apple-input" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notlar</label>
                <textarea value={transferForm.notlar} onChange={e => setTransferForm(p => ({ ...p, notlar: e.target.value }))} className="apple-input resize-none" rows={2} />
              </div>
              <button onClick={saveTransfer} disabled={saving} className="apple-button-primary w-full">{saving ? 'Kaydediliyor...' : 'Transfer Oluştur'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
