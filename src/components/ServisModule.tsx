import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query
} from '../lib/dbClient';
import { db } from '../firebase';
import MikroPushButton from './MikroPushButton';
import { servisIsEmriPayload } from '../services/mikroEvrak';
import { sortByCreatedAt } from '../utils/fsSort';
import {
  HeadphonesIcon, ShieldCheck, Users, BarChart2,
  Plus, X, Star, AlertCircle, CheckCircle, Clock, Edit2, Trash2
} from 'lucide-react';

interface ServisTalebi {
  id: string;
  talepNo: string;
  musteriAd: string;
  urunAd: string;
  seriNo: string;
  kategori: 'Arıza' | 'Kurulum' | 'Bakım' | 'Danışmanlık';
  oncelik: 1 | 2 | 3 | 4;
  aciklama: string;
  atanan: string;
  slaGun: number;
  notlar: string;
  durum: 'Açık' | 'İşlemde' | 'Bekliyor-Müşteri' | 'Çözüldü' | 'İptal';
  acilisTarihi: string;
  cozumAciklamasi?: string;
  memnuniyetPuani?: number;
  createdAt?: any;
}

interface Garanti {
  id: string;
  urunAd: string;
  seriNo: string;
  musteriAd: string;
  satisTarihi: string;
  garantiBitis: string;
  createdAt?: any;
}

interface Teknisyen {
  id: string;
  ad: string;
  uzmanlik: string;
  acikTalep: number;
  tamamlanan: number;
  ortPuan: number;
  createdAt?: any;
}

const TABS = ['Servis Talepleri', 'SLA Takibi', 'Garanti', 'Teknisyenler'] as const;
type Tab = typeof TABS[number];

const ONCELIK_MAP: Record<number, { label: string; cls: string }> = {
  1: { label: 'Kritik', cls: 'bg-red-100 text-red-700' },
  2: { label: 'Yüksek', cls: 'bg-amber-100 text-amber-700' },
  3: { label: 'Orta', cls: 'bg-blue-100 text-blue-700' },
  4: { label: 'Düşük', cls: 'bg-gray-100 text-gray-600' },
};

const DURUM_CLS: Record<string, string> = {
  'Açık': 'bg-blue-100 text-blue-700',
  'İşlemde': 'bg-amber-100 text-amber-700',
  'Bekliyor-Müşteri': 'bg-purple-100 text-purple-700',
  'Çözüldü': 'bg-green-100 text-green-700',
  'İptal': 'bg-gray-100 text-gray-500',
};

function DurumBadge({ durum }: { durum: string }) {
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${DURUM_CLS[durum] ?? 'bg-gray-100 text-gray-600'}`}>{durum}</span>;
}

function slaDeadline(acilis: string, slaGun: number): Date {
  const d = new Date(acilis);
  d.setDate(d.getDate() + slaGun);
  return d;
}

function slaStatus(talep: ServisTalebi): 'breach' | 'warning' | 'ok' {
  if (['Çözüldü', 'İptal'].includes(talep.durum)) return 'ok';
  const deadline = slaDeadline(talep.acilisTarihi, talep.slaGun);
  const diffH = (deadline.getTime() - Date.now()) / 3600000;
  if (diffH < 0) return 'breach';
  if (diffH < 24) return 'warning';
  return 'ok';
}

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-5 h-5 cursor-pointer transition-colors ${i <= value ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`}
          onClick={() => onChange?.(i)} />
      ))}
    </div>
  );
}

function garantiDurum(bitis: string): { label: string; cls: string } {
  const days = Math.ceil((new Date(bitis).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: 'Expired', cls: 'bg-red-100 text-red-700' };
  if (days < 30) return { label: 'Süresi Dolmak Üzere', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Aktif', cls: 'bg-green-100 text-green-700' };
}

const inputCls = 'apple-input text-sm';
const labelCls = 'text-xs font-medium text-gray-500 mb-1 block';

const emptyTalep: Omit<ServisTalebi, 'id'> = {
  talepNo: '', musteriAd: '', urunAd: '', seriNo: '', kategori: 'Arıza',
  oncelik: 3, aciklama: '', atanan: '', slaGun: 3, notlar: '',
  durum: 'Açık', acilisTarihi: new Date().toISOString().slice(0, 10),
};

const emptyGaranti: Omit<Garanti, 'id'> = {
  urunAd: '', seriNo: '', musteriAd: '', satisTarihi: '', garantiBitis: '',
};

const emptyTeknisyen: Omit<Teknisyen, 'id'> = {
  ad: '', uzmanlik: '', acikTalep: 0, tamamlanan: 0, ortPuan: 0,
};

export default function ServisModule({ currentLanguage: _lang, isAuthenticated }: { currentLanguage: string; isAuthenticated: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>('Servis Talepleri');
  const [talepler, setTalepler] = useState<ServisTalebi[]>([]);
  const [garantiler, setGarantiler] = useState<Garanti[]>([]);
  const [teknisyenler, setTeknisyenler] = useState<Teknisyen[]>([]);

  const [showTalepModal, setShowTalepModal] = useState(false);
  const [talepForm, setTalepForm] = useState({ ...emptyTalep });

  const [closingTalep, setClosingTalep] = useState<ServisTalebi | null>(null);
  const [cozumAciklama, setCozumAciklama] = useState('');
  const [memnuniyet, setMemnuniyet] = useState(5);

  const [showGarantiModal, setShowGarantiModal] = useState(false);
  const [garantiForm, setGarantiForm] = useState({ ...emptyGaranti });

  const [showTeknisyenModal, setShowTeknisyenModal] = useState(false);
  const [editingTeknisyen, setEditingTeknisyen] = useState<Teknisyen | null>(null);
  const [teknisyenForm, setTeknisyenForm] = useState({ ...emptyTeknisyen });

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubs = [
      onSnapshot(query(collection(db, 'servisTalepleri')), snap =>
        setTalepler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as ServisTalebi))))),
      onSnapshot(query(collection(db, 'garantiler')), snap =>
        setGarantiler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Garanti))))),
      onSnapshot(query(collection(db, 'teknisyenler')), snap =>
        setTeknisyenler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Teknisyen))))),
    ];
    return () => unsubs.forEach(u => u());
  }, [isAuthenticated]);

  async function saveTalep() {
    if (!talepForm.musteriAd || !talepForm.aciklama) return;
    const talepNo = `ST-2026-${String(Date.now()).slice(-4)}`;
    await addDoc(collection(db, 'servisTalepleri'), {
      ...talepForm, talepNo, createdAt: serverTimestamp(),
    });
    setShowTalepModal(false);
    setTalepForm({ ...emptyTalep });
  }

  async function closeTalep() {
    if (!closingTalep) return;
    await updateDoc(doc(db, 'servisTalepleri', closingTalep.id), {
      durum: 'Çözüldü',
      cozumAciklamasi: cozumAciklama,
      memnuniyetPuani: memnuniyet,
    });
    setClosingTalep(null);
    setCozumAciklama('');
    setMemnuniyet(5);
  }

  async function updateTalepDurum(id: string, durum: ServisTalebi['durum']) {
    await updateDoc(doc(db, 'servisTalepleri', id), { durum });
  }

  async function saveGaranti() {
    if (!garantiForm.urunAd || !garantiForm.garantiBitis) return;
    await addDoc(collection(db, 'garantiler'), { ...garantiForm, createdAt: serverTimestamp() });
    setShowGarantiModal(false);
    setGarantiForm({ ...emptyGaranti });
  }

  async function saveTeknisyen() {
    if (!teknisyenForm.ad) return;
    if (editingTeknisyen) {
      await updateDoc(doc(db, 'teknisyenler', editingTeknisyen.id), { ...teknisyenForm });
    } else {
      await addDoc(collection(db, 'teknisyenler'), { ...teknisyenForm, createdAt: serverTimestamp() });
    }
    setShowTeknisyenModal(false);
    setEditingTeknisyen(null);
    setTeknisyenForm({ ...emptyTeknisyen });
  }

  async function deleteTeknisyen(id: string) {
    if (!confirm('Teknisyen silinsin mi?')) return;
    await deleteDoc(doc(db, 'teknisyenler', id));
  }

  const acik = talepler.filter(t => !['Çözüldü', 'İptal'].includes(t.durum)).length;
  const bugunAcilan = talepler.filter(t => t.acilisTarihi === new Date().toISOString().slice(0, 10)).length;
  const cozulenler = talepler.filter(t => t.durum === 'Çözüldü');
  const puanlilar = cozulenler.filter(t => t.memnuniyetPuani);
  const ortMemnuniyet = puanlilar.length ? Math.round((puanlilar.reduce((s, t) => s + (t.memnuniyetPuani ?? 0), 0) / puanlilar.length) * 20) : 0;

  const expiringSoon = garantiler.filter(g => {
    const days = Math.ceil((new Date(g.garantiBitis).getTime() - Date.now()) / 86400000);
    return days >= 0 && days < 30;
  });

  // SLA stats per category
  const categories = ['Arıza', 'Kurulum', 'Bakım', 'Danışmanlık'] as const;
  const slaStats = categories.map(cat => {
    const catTalepler = talepler.filter(t => t.kategori === cat);
    const breached = catTalepler.filter(t => slaStatus(t) === 'breach').length;
    return { cat, total: catTalepler.length, breached, rate: catTalepler.length ? Math.round((breached / catTalepler.length) * 100) : 0 };
  });

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="overflow-x-auto scrollbar-none">
        <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
          {TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`shrink-0 inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${activeTab === t ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* SERVİS TALEPLERİ */}
      {activeTab === 'Servis Talepleri' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Açık Talepler', value: acik, color: 'text-blue-600' },
              { label: 'Bugün Açılan', value: bugunAcilan, color: 'text-amber-600' },
              { label: 'Toplam Çözülen', value: cozulenler.length, color: 'text-green-600' },
              { label: 'Müşteri Memnuniyeti', value: `${ortMemnuniyet}%`, color: 'text-purple-600' },
            ].map(k => (
              <div key={k.label} className="apple-card p-4 text-center">
                <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                <div className="text-xs text-gray-400 mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="apple-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Servis Talepleri</h2>
              <button onClick={() => setShowTalepModal(true)}
                className="apple-button-primary text-sm flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Yeni Talep
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left">
                  {['Talep No', 'Müşteri', 'Ürün', 'Kategori', 'Öncelik', 'SLA', 'Durum', 'Atanan', 'İşlem'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {talepler.map(t => {
                    const sla = slaStatus(t);
                    const deadline = slaDeadline(t.acilisTarihi, t.slaGun);
                    const rowCls = sla === 'breach' ? 'bg-red-50/40' : sla === 'warning' ? 'bg-amber-50/40' : '';
                    return (
                      <tr key={t.id} className={`hover:bg-gray-50/50 transition-colors ${rowCls}`}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">
                          <div className="flex items-center gap-1.5">
                            {t.talepNo}
                            <MikroPushButton
                              compact
                              method="ServisIsEmriKaydetV2"
                              entityType="servisTalebi"
                              entityId={t.id}
                              buildPayload={() => servisIsEmriPayload({
                                kod: t.talepNo,
                                ad: `${t.kategori} — ${t.urunAd}`.slice(0, 40),
                                cariKod: (t as unknown as { mikroCariKod?: string }).mikroCariKod ?? '',
                                cihazSeriNo: t.seriNo,
                                yetkili: t.atanan,
                                aciklama: t.aciklama,
                                date: t.acilisTarihi,
                              })}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800">{t.musteriAd}</td>
                        <td className="px-4 py-3 text-gray-500">{t.urunAd}</td>
                        <td className="px-4 py-3 text-gray-500">{t.kategori}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ONCELIK_MAP[t.oncelik]?.cls}`}>
                            {ONCELIK_MAP[t.oncelik]?.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {sla === 'breach' && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                            {sla === 'warning' && <Clock className="w-3.5 h-3.5 text-amber-500" />}
                            {sla === 'ok' && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                            <span className="text-xs text-gray-500">{deadline.toLocaleDateString('tr-TR')}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><DurumBadge durum={t.durum} /></td>
                        <td className="px-4 py-3 text-gray-500">{t.atanan || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {t.durum === 'Açık' && (
                              <button onClick={() => updateTalepDurum(t.id, 'İşlemde')}
                                className="text-xs apple-button-secondary py-1 px-2">Başlat</button>
                            )}
                            {!['Çözüldü', 'İptal'].includes(t.durum) && (
                              <button onClick={() => { setClosingTalep(t); setCozumAciklama(''); setMemnuniyet(5); }}
                                className="text-xs apple-button-primary py-1 px-2">Kapat</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {talepler.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">Henüz servis talebi yok</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SLA TAKİBİ */}
      {activeTab === 'SLA Takibi' && (
        <div className="space-y-4">
          <div className="apple-card p-5">
            <h2 className="font-semibold text-gray-800 mb-4">Kategoriye Göre SLA Uyum</h2>
            <div className="space-y-3">
              {slaStats.map(s => (
                <div key={s.cat}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">{s.cat}</span>
                    <span className="text-xs text-gray-400">{s.breached}/{s.total} ihlal — %{s.rate}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${s.rate > 30 ? 'bg-red-400' : s.rate > 10 ? 'bg-amber-400' : 'bg-green-400'}`}
                      style={{ width: `${Math.min(s.rate, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="apple-card p-5">
            <h2 className="font-semibold text-gray-800 mb-4">Teknisyen Bazlı Yük</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left">
                  {['Teknisyen', 'Açık Talep', 'Tamamlanan', 'Ort. Puan'].map(h => (
                    <th key={h} className="pb-3 text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {teknisyenler.map(tk => (
                    <tr key={tk.id}>
                      <td className="py-2.5 font-medium text-gray-800">{tk.ad}</td>
                      <td className="py-2.5 text-blue-600 font-semibold">{tk.acikTalep}</td>
                      <td className="py-2.5 text-green-600 font-semibold">{tk.tamamlanan}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1">
                          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                          <span className="text-gray-700">{tk.ortPuan.toFixed(1)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {teknisyenler.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-gray-400 text-sm">Teknisyen eklenmedi</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* GARANTİ */}
      {activeTab === 'Garanti' && (
        <div className="space-y-4">
          {expiringSoon.length > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="text-sm text-amber-700">{expiringSoon.length} garantinin süresi 30 gün içinde doluyor.</span>
            </div>
          )}
          <div className="apple-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Garanti Kayıtları</h2>
              <button onClick={() => setShowGarantiModal(true)}
                className="apple-button-primary text-sm flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Garanti Ekle
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left">
                  {['Ürün', 'Seri No', 'Müşteri', 'Satış Tarihi', 'Garanti Bitiş', 'Kalan Gün', 'Durum'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {garantiler.map(g => {
                    const days = Math.ceil((new Date(g.garantiBitis).getTime() - Date.now()) / 86400000);
                    const { label, cls } = garantiDurum(g.garantiBitis);
                    return (
                      <tr key={g.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{g.urunAd}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{g.seriNo}</td>
                        <td className="px-4 py-3 text-gray-500">{g.musteriAd}</td>
                        <td className="px-4 py-3 text-gray-500">{g.satisTarihi}</td>
                        <td className="px-4 py-3 text-gray-500">{g.garantiBitis}</td>
                        <td className="px-4 py-3 text-gray-700 font-medium">{days > 0 ? `${days}g` : '—'}</td>
                        <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span></td>
                      </tr>
                    );
                  })}
                  {garantiler.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">Garanti kaydı yok</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TEKNİSYENLER */}
      {activeTab === 'Teknisyenler' && (
        <div className="space-y-4">
          <div className="apple-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Teknisyen Kadrosu</h2>
              <button onClick={() => { setEditingTeknisyen(null); setTeknisyenForm({ ...emptyTeknisyen }); setShowTeknisyenModal(true); }}
                className="apple-button-primary text-sm flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Teknisyen Ekle
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left">
                  {['Ad', 'Uzmanlık', 'Açık Talep', 'Tamamlanan', 'Ort. Puan', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {teknisyenler.map(tk => (
                    <tr key={tk.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800">{tk.ad}</td>
                      <td className="px-4 py-3 text-gray-500">{tk.uzmanlik}</td>
                      <td className="px-4 py-3 text-blue-600 font-semibold">{tk.acikTalep}</td>
                      <td className="px-4 py-3 text-green-600 font-semibold">{tk.tamamlanan}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <StarRating value={Math.round(tk.ortPuan)} />
                          <span className="text-xs text-gray-500 ml-1">{tk.ortPuan.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => { setEditingTeknisyen(tk); setTeknisyenForm({ ...tk }); setShowTeknisyenModal(true); }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteTeknisyen(tk.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {teknisyenler.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">Teknisyen kaydı yok</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* YENİ TALEP MODAL */}
      {showTalepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Yeni Servis Talebi</h3>
              <button onClick={() => setShowTalepModal(false)} className="p-2 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {([
                ['musteriAd', 'Müşteri Adı', 'text'],
                ['urunAd', 'Ürün Adı', 'text'],
                ['seriNo', 'Seri No', 'text'],
                ['atanan', 'Atanan Teknisyen', 'text'],
                ['acilisTarihi', 'Açılış Tarihi', 'date'],
                ['slaGun', 'SLA (Gün)', 'number'],
              ] as [keyof typeof talepForm, string, string][]).map(([key, label, type]) => (
                <div key={key}>
                  <label className={labelCls}>{label}</label>
                  <input type={type} className={inputCls} value={(talepForm as any)[key]}
                    onChange={e => setTalepForm(f => ({ ...f, [key]: type === 'number' ? +e.target.value : e.target.value }))} />
                </div>
              ))}
              <div>
                <label className={labelCls}>Kategori</label>
                <select className={inputCls} value={talepForm.kategori}
                  onChange={e => setTalepForm(f => ({ ...f, kategori: e.target.value as any }))}>
                  {['Arıza', 'Kurulum', 'Bakım', 'Danışmanlık'].map(k => <option key={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Öncelik</label>
                <select className={inputCls} value={talepForm.oncelik}
                  onChange={e => setTalepForm(f => ({ ...f, oncelik: +e.target.value as any }))}>
                  {[1, 2, 3, 4].map(p => <option key={p} value={p}>{ONCELIK_MAP[p].label}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Açıklama</label>
                <textarea className={`${inputCls} h-20 resize-none`} value={talepForm.aciklama}
                  onChange={e => setTalepForm(f => ({ ...f, aciklama: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Notlar</label>
                <textarea className={`${inputCls} h-16 resize-none`} value={talepForm.notlar}
                  onChange={e => setTalepForm(f => ({ ...f, notlar: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button onClick={() => setShowTalepModal(false)} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveTalep} className="apple-button-primary text-sm">Talep Oluştur</button>
            </div>
          </div>
        </div>
      )}

      {/* TALEBİ KAPAT MODAL */}
      {closingTalep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Talebi Kapat — {closingTalep.talepNo}</h3>
              <button onClick={() => setClosingTalep(null)} className="p-2 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Çözüm Açıklaması</label>
                <textarea className={`${inputCls} h-24 resize-none`} value={cozumAciklama}
                  onChange={e => setCozumAciklama(e.target.value)} placeholder="Uygulanan çözümü açıklayınız..." />
              </div>
              <div>
                <label className={labelCls}>Müşteri Memnuniyeti</label>
                <div className="mt-2">
                  <StarRating value={memnuniyet} onChange={setMemnuniyet} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button onClick={() => setClosingTalep(null)} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={closeTalep} className="apple-button-primary text-sm">Çözüldü Olarak Kapat</button>
            </div>
          </div>
        </div>
      )}

      {/* GARANTİ MODAL */}
      {showGarantiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Garanti Kaydı Ekle</h3>
              <button onClick={() => setShowGarantiModal(false)} className="p-2 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {([
                ['urunAd', 'Ürün Adı', 'text'],
                ['seriNo', 'Seri No', 'text'],
                ['musteriAd', 'Müşteri', 'text'],
                ['satisTarihi', 'Satış Tarihi', 'date'],
                ['garantiBitis', 'Garanti Bitiş', 'date'],
              ] as [keyof typeof garantiForm, string, string][]).map(([key, label, type]) => (
                <div key={key}>
                  <label className={labelCls}>{label}</label>
                  <input type={type} className={inputCls} value={(garantiForm as any)[key]}
                    onChange={e => setGarantiForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button onClick={() => setShowGarantiModal(false)} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveGaranti} className="apple-button-primary text-sm">Kaydet</button>
            </div>
          </div>
        </div>
      )}

      {/* TEKNİSYEN MODAL */}
      {showTeknisyenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">{editingTeknisyen ? 'Teknisyen Düzenle' : 'Teknisyen Ekle'}</h3>
              <button onClick={() => { setShowTeknisyenModal(false); setEditingTeknisyen(null); }} className="p-2 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>Ad Soyad</label>
                <input type="text" className={inputCls} value={teknisyenForm.ad}
                  onChange={e => setTeknisyenForm(f => ({ ...f, ad: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Uzmanlık Alanı</label>
                <input type="text" className={inputCls} value={teknisyenForm.uzmanlik}
                  onChange={e => setTeknisyenForm(f => ({ ...f, uzmanlik: e.target.value }))} />
              </div>
              {([
                ['acikTalep', 'Açık Talep'],
                ['tamamlanan', 'Tamamlanan'],
                ['ortPuan', 'Ortalama Puan'],
              ] as [keyof typeof teknisyenForm, string][]).map(([key, label]) => (
                <div key={key}>
                  <label className={labelCls}>{label}</label>
                  <input type="number" step="0.1" className={inputCls} value={(teknisyenForm as any)[key]}
                    onChange={e => setTeknisyenForm(f => ({ ...f, [key]: +e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button onClick={() => { setShowTeknisyenModal(false); setEditingTeknisyen(null); }} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveTeknisyen} className="apple-button-primary text-sm">
                {editingTeknisyen ? 'Güncelle' : 'Ekle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
