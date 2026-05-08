import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Wrench, ClipboardList, CalendarDays, AlertTriangle,
  Plus, X, CheckCircle, Clock, Settings, Zap, Car, Monitor, Package,
  Edit2, Trash2
} from 'lucide-react';

interface Ekipman {
  id: string;
  ekipmanKodu: string;
  ad: string;
  kategori: 'Makine' | 'Elektrik' | 'Araç' | 'BT' | 'Diğer';
  konum: string;
  seriNo: string;
  uretici: string;
  model: string;
  alisTarihi: string;
  garantiBitis: string;
  bakimSikligi: number;
  sonBakim: string;
  notlar: string;
  durum: 'Aktif' | 'Bakımda' | 'Arızalı' | 'Emekli';
  createdAt?: any;
}

interface IsEmri {
  id: string;
  ekipmanId: string;
  ekipmanAd: string;
  isTipi: 'Önleyici' | 'Düzeltici' | 'Acil';
  oncelik: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik';
  aciklama: string;
  atanan: string;
  planlananTarih: string;
  tahminiSure: number;
  durum: 'Açık' | 'Devam Ediyor' | 'Tamamlandı' | 'İptal';
  createdAt?: any;
}

interface Ariza {
  id: string;
  ekipmanId: string;
  ekipmanAd: string;
  tarih: string;
  aciklama: string;
  etki: 'Düşük' | 'Orta' | 'Kritik';
  cozum: string;
  cozumSuresi: number;
  createdAt?: any;
}

const TABS = ['Ekipmanlar', 'İş Emirleri', 'Bakım Planı', 'Arızalar'] as const;
type Tab = typeof TABS[number];

const KATEGORİ_ICONS: Record<string, any> = {
  Makine: Settings, Elektrik: Zap, Araç: Car, BT: Monitor, Diğer: Package
};

function daysUntil(dateStr: string): number {
  if (!dateStr) return 999;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function nextMaintenance(sonBakim: string, sikligi: number): string {
  if (!sonBakim || !sikligi) return '';
  const d = new Date(sonBakim);
  d.setDate(d.getDate() + sikligi);
  return d.toISOString().slice(0, 10);
}

function DaysBadge({ days }: { days: number }) {
  const cls = days < 7
    ? 'bg-red-100 text-red-700'
    : days < 30
    ? 'bg-amber-100 text-amber-700'
    : 'bg-green-100 text-green-700';
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{days}g</span>;
}

function DurumBadge({ durum }: { durum: string }) {
  const map: Record<string, string> = {
    Aktif: 'bg-green-100 text-green-700',
    Bakımda: 'bg-amber-100 text-amber-700',
    Arızalı: 'bg-red-100 text-red-700',
    Emekli: 'bg-gray-100 text-gray-500',
    Açık: 'bg-blue-100 text-blue-700',
    'Devam Ediyor': 'bg-amber-100 text-amber-700',
    Tamamlandı: 'bg-green-100 text-green-700',
    İptal: 'bg-gray-100 text-gray-500',
    Düşük: 'bg-gray-100 text-gray-600',
    Orta: 'bg-blue-100 text-blue-700',
    Yüksek: 'bg-amber-100 text-amber-700',
    Kritik: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[durum] ?? 'bg-gray-100 text-gray-600'}`}>
      {durum}
    </span>
  );
}

const emptyEkipman: Omit<Ekipman, 'id'> = {
  ekipmanKodu: '', ad: '', kategori: 'Makine', konum: '', seriNo: '',
  uretici: '', model: '', alisTarihi: '', garantiBitis: '',
  bakimSikligi: 30, sonBakim: '', notlar: '', durum: 'Aktif',
};

const emptyIsEmri: Omit<IsEmri, 'id'> = {
  ekipmanId: '', ekipmanAd: '', isTipi: 'Önleyici', oncelik: 'Orta',
  aciklama: '', atanan: '', planlananTarih: '', tahminiSure: 1, durum: 'Açık',
};

const emptyAriza: Omit<Ariza, 'id'> = {
  ekipmanId: '', ekipmanAd: '', tarih: new Date().toISOString().slice(0, 10),
  aciklama: '', etki: 'Orta', cozum: '', cozumSuresi: 0,
};

export default function BakimModule({ currentLanguage: _lang, isAuthenticated }: { currentLanguage: string; isAuthenticated: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>('Ekipmanlar');
  const [ekipmanlar, setEkipmanlar] = useState<Ekipman[]>([]);
  const [isEmirleri, setIsEmirleri] = useState<IsEmri[]>([]);
  const [arizalar, setArizalar] = useState<Ariza[]>([]);

  const [showEkipmanModal, setShowEkipmanModal] = useState(false);
  const [editingEkipman, setEditingEkipman] = useState<Ekipman | null>(null);
  const [ekipmanForm, setEkipmanForm] = useState({ ...emptyEkipman });

  const [showIsEmriModal, setShowIsEmriModal] = useState(false);
  const [isEmriForm, setIsEmriForm] = useState({ ...emptyIsEmri });

  const [showArizaModal, setShowArizaModal] = useState(false);
  const [arizaForm, setArizaForm] = useState({ ...emptyAriza });

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubs = [
      onSnapshot(query(collection(db, 'ekipmanlar'), orderBy('createdAt', 'desc')), snap =>
        setEkipmanlar(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ekipman)))),
      onSnapshot(query(collection(db, 'isEmirleri'), orderBy('createdAt', 'desc')), snap =>
        setIsEmirleri(snap.docs.map(d => ({ id: d.id, ...d.data() } as IsEmri)))),
      onSnapshot(query(collection(db, 'arizalar'), orderBy('createdAt', 'desc')), snap =>
        setArizalar(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ariza)))),
    ];
    return () => unsubs.forEach(u => u());
  }, [isAuthenticated]);

  async function saveEkipman() {
    if (!ekipmanForm.ekipmanKodu || !ekipmanForm.ad) return;
    if (editingEkipman) {
      await updateDoc(doc(db, 'ekipmanlar', editingEkipman.id), { ...ekipmanForm });
    } else {
      await addDoc(collection(db, 'ekipmanlar'), { ...ekipmanForm, createdAt: serverTimestamp() });
    }
    setShowEkipmanModal(false);
    setEditingEkipman(null);
    setEkipmanForm({ ...emptyEkipman });
  }

  async function deleteEkipman(id: string) {
    if (!confirm('Ekipman silinsin mi?')) return;
    await deleteDoc(doc(db, 'ekipmanlar', id));
  }

  async function saveIsEmri() {
    if (!isEmriForm.ekipmanId || !isEmriForm.aciklama) return;
    const ekipman = ekipmanlar.find(e => e.id === isEmriForm.ekipmanId);
    const emriNo = `IE-${Date.now().toString().slice(-6)}`;
    await addDoc(collection(db, 'isEmirleri'), {
      ...isEmriForm,
      ekipmanAd: ekipman?.ad ?? '',
      emriNo,
      createdAt: serverTimestamp(),
    });
    setShowIsEmriModal(false);
    setIsEmriForm({ ...emptyIsEmri });
  }

  async function updateIsEmriDurum(id: string, durum: IsEmri['durum']) {
    await updateDoc(doc(db, 'isEmirleri', id), { durum });
  }

  async function saveAriza() {
    if (!arizaForm.ekipmanAd || !arizaForm.aciklama) return;
    await addDoc(collection(db, 'arizalar'), { ...arizaForm, createdAt: serverTimestamp() });
    setShowArizaModal(false);
    setArizaForm({ ...emptyAriza });
  }

  const kpis = {
    toplam: ekipmanlar.length,
    aktif: ekipmanlar.filter(e => e.durum === 'Aktif').length,
    bakimda: ekipmanlar.filter(e => e.durum === 'Bakımda').length,
    arizali: ekipmanlar.filter(e => e.durum === 'Arızalı').length,
  };

  const planlilar = ekipmanlar
    .filter(e => e.sonBakim && e.bakimSikligi)
    .map(e => ({ ...e, nextDate: nextMaintenance(e.sonBakim, e.bakimSikligi), days: daysUntil(nextMaintenance(e.sonBakim, e.bakimSikligi)) }))
    .filter(e => e.days <= 30)
    .sort((a, b) => a.days - b.days);

  const inputCls = 'apple-input text-sm';
  const labelCls = 'text-xs font-medium text-gray-500 mb-1 block';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Bakım Yönetimi</h1>
            <p className="text-xs text-gray-400">Ekipman & İş Emri Takibi</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${activeTab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* EKIPMANLAR TAB */}
      {activeTab === 'Ekipmanlar' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Toplam Ekipman', value: kpis.toplam, color: 'text-gray-800' },
              { label: 'Aktif', value: kpis.aktif, color: 'text-green-600' },
              { label: 'Bakımda', value: kpis.bakimda, color: 'text-amber-600' },
              { label: 'Arızalı', value: kpis.arizali, color: 'text-red-600' },
            ].map(k => (
              <div key={k.label} className="apple-card text-center">
                <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                <div className="text-xs text-gray-400 mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="apple-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Ekipman Listesi</h2>
              <button onClick={() => { setEditingEkipman(null); setEkipmanForm({ ...emptyEkipman }); setShowEkipmanModal(true); }}
                className="apple-button-primary text-sm flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Ekipman Ekle
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left">
                  {['Kod', 'Ad', 'Kategori', 'Konum', 'Son Bakım', 'Sonraki Bakım', 'Durum', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {ekipmanlar.map(e => {
                    const next = nextMaintenance(e.sonBakim, e.bakimSikligi);
                    const days = daysUntil(next);
                    const Icon = KATEGORİ_ICONS[e.kategori] ?? Package;
                    return (
                      <tr key={e.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{e.ekipmanKodu}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{e.ad}</td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1 text-gray-500"><Icon className="w-3.5 h-3.5" />{e.kategori}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{e.konum}</td>
                        <td className="px-4 py-3 text-gray-500">{e.sonBakim || '—'}</td>
                        <td className="px-4 py-3">{next ? <DaysBadge days={days} /> : '—'}</td>
                        <td className="px-4 py-3"><DurumBadge durum={e.durum} /></td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button onClick={() => { setEditingEkipman(e); setEkipmanForm({ ...e }); setShowEkipmanModal(true); }}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteEkipman(e.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {ekipmanlar.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Henüz ekipman eklenmedi</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* İŞ EMİRLERİ TAB */}
      {activeTab === 'İş Emirleri' && (
        <div className="space-y-4">
          <div className="apple-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">İş Emirleri</h2>
              <button onClick={() => setShowIsEmriModal(true)}
                className="apple-button-primary text-sm flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> İş Emri Oluştur
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left">
                  {['No', 'Ekipman', 'İş Tipi', 'Öncelik', 'Atanan', 'Tarih', 'Durum', 'İşlem'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {isEmirleri.map(ie => (
                    <tr key={ie.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{(ie as any).emriNo ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{ie.ekipmanAd}</td>
                      <td className="px-4 py-3 text-gray-500">{ie.isTipi}</td>
                      <td className="px-4 py-3"><DurumBadge durum={ie.oncelik} /></td>
                      <td className="px-4 py-3 text-gray-500">{ie.atanan || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{ie.planlananTarih}</td>
                      <td className="px-4 py-3"><DurumBadge durum={ie.durum} /></td>
                      <td className="px-4 py-3">
                        {ie.durum === 'Açık' && (
                          <button onClick={() => updateIsEmriDurum(ie.id, 'Devam Ediyor')}
                            className="text-xs apple-button-secondary py-1 px-2">Başlat</button>
                        )}
                        {ie.durum === 'Devam Ediyor' && (
                          <button onClick={() => updateIsEmriDurum(ie.id, 'Tamamlandı')}
                            className="text-xs apple-button-primary py-1 px-2">Tamamla</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {isEmirleri.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Henüz iş emri yok</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* BAKIM PLANI TAB */}
      {activeTab === 'Bakım Planı' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-500">Önümüzdeki 30 gün içinde bakım gereken ekipmanlar</span>
          </div>
          {planlilar.length === 0 && (
            <div className="apple-card text-center py-10 text-gray-400">Önümüzdeki 30 günde planlanmış bakım yok</div>
          )}
          {planlilar.map(e => (
            <div key={e.id} className="apple-card flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-800">{e.ad}</div>
                <div className="text-xs text-gray-400 mt-0.5">{e.konum} · Son bakım: {e.sonBakim}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-gray-400">Sonraki Bakım</div>
                  <div className="text-sm font-medium text-gray-700">{e.nextDate}</div>
                </div>
                <DaysBadge days={e.days} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ARIZALAR TAB */}
      {activeTab === 'Arızalar' && (
        <div className="space-y-4">
          <div className="apple-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Arıza Kayıtları</h2>
              <button onClick={() => setShowArizaModal(true)}
                className="apple-button-primary text-sm flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Arıza Bildir
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left">
                  {['Tarih', 'Ekipman', 'Açıklama', 'Etki', 'Çözüm', 'Çözüm Süresi'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {arizalar.map(a => (
                    <tr key={a.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-gray-500">{a.tarih}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{a.ekipmanAd}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{a.aciklama}</td>
                      <td className="px-4 py-3"><DurumBadge durum={a.etki} /></td>
                      <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{a.cozum || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{a.cozumSuresi ? `${a.cozumSuresi} sa` : '—'}</td>
                    </tr>
                  ))}
                  {arizalar.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">Arıza kaydı bulunmuyor</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* EKIPMAN MODAL */}
      {showEkipmanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">{editingEkipman ? 'Ekipman Düzenle' : 'Yeni Ekipman'}</h3>
              <button onClick={() => { setShowEkipmanModal(false); setEditingEkipman(null); }}
                className="p-2 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {([
                ['ekipmanKodu', 'Ekipman Kodu', 'text'],
                ['ad', 'Ekipman Adı', 'text'],
                ['konum', 'Konum', 'text'],
                ['seriNo', 'Seri No', 'text'],
                ['uretici', 'Üretici', 'text'],
                ['model', 'Model', 'text'],
                ['alisTarihi', 'Alış Tarihi', 'date'],
                ['garantiBitis', 'Garanti Bitiş', 'date'],
                ['sonBakim', 'Son Bakım', 'date'],
                ['bakimSikligi', 'Bakım Sıklığı (Gün)', 'number'],
              ] as [keyof typeof ekipmanForm, string, string][]).map(([key, label, type]) => (
                <div key={key}>
                  <label className={labelCls}>{label}</label>
                  <input type={type} className={inputCls} value={(ekipmanForm as any)[key]}
                    onChange={e => setEkipmanForm(f => ({ ...f, [key]: type === 'number' ? +e.target.value : e.target.value }))} />
                </div>
              ))}
              <div>
                <label className={labelCls}>Kategori</label>
                <select className={inputCls} value={ekipmanForm.kategori}
                  onChange={e => setEkipmanForm(f => ({ ...f, kategori: e.target.value as any }))}>
                  {['Makine', 'Elektrik', 'Araç', 'BT', 'Diğer'].map(k => <option key={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Durum</label>
                <select className={inputCls} value={ekipmanForm.durum}
                  onChange={e => setEkipmanForm(f => ({ ...f, durum: e.target.value as any }))}>
                  {['Aktif', 'Bakımda', 'Arızalı', 'Emekli'].map(k => <option key={k}>{k}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Notlar</label>
                <textarea className={`${inputCls} h-20 resize-none`} value={ekipmanForm.notlar}
                  onChange={e => setEkipmanForm(f => ({ ...f, notlar: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button onClick={() => { setShowEkipmanModal(false); setEditingEkipman(null); }} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveEkipman} className="apple-button-primary text-sm">
                {editingEkipman ? 'Güncelle' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* İŞ EMRİ MODAL */}
      {showIsEmriModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">İş Emri Oluştur</h3>
              <button onClick={() => setShowIsEmriModal(false)} className="p-2 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Ekipman</label>
                <select className={inputCls} value={isEmriForm.ekipmanId}
                  onChange={e => setIsEmriForm(f => ({ ...f, ekipmanId: e.target.value }))}>
                  <option value="">Seçiniz</option>
                  {ekipmanlar.map(e => <option key={e.id} value={e.id}>{e.ad}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>İş Tipi</label>
                  <select className={inputCls} value={isEmriForm.isTipi}
                    onChange={e => setIsEmriForm(f => ({ ...f, isTipi: e.target.value as any }))}>
                    {['Önleyici', 'Düzeltici', 'Acil'].map(k => <option key={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Öncelik</label>
                  <select className={inputCls} value={isEmriForm.oncelik}
                    onChange={e => setIsEmriForm(f => ({ ...f, oncelik: e.target.value as any }))}>
                    {['Düşük', 'Orta', 'Yüksek', 'Kritik'].map(k => <option key={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Atanan</label>
                  <input type="text" className={inputCls} value={isEmriForm.atanan}
                    onChange={e => setIsEmriForm(f => ({ ...f, atanan: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Planlanan Tarih</label>
                  <input type="date" className={inputCls} value={isEmriForm.planlananTarih}
                    onChange={e => setIsEmriForm(f => ({ ...f, planlananTarih: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Tahmini Süre (Saat)</label>
                  <input type="number" className={inputCls} value={isEmriForm.tahminiSure}
                    onChange={e => setIsEmriForm(f => ({ ...f, tahminiSure: +e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Açıklama</label>
                <textarea className={`${inputCls} h-20 resize-none`} value={isEmriForm.aciklama}
                  onChange={e => setIsEmriForm(f => ({ ...f, aciklama: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button onClick={() => setShowIsEmriModal(false)} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveIsEmri} className="apple-button-primary text-sm">Oluştur</button>
            </div>
          </div>
        </div>
      )}

      {/* ARIZA MODAL */}
      {showArizaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Arıza Bildir</h3>
              <button onClick={() => setShowArizaModal(false)} className="p-2 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Ekipman Adı</label>
                  <input type="text" className={inputCls} value={arizaForm.ekipmanAd}
                    onChange={e => setArizaForm(f => ({ ...f, ekipmanAd: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Tarih</label>
                  <input type="date" className={inputCls} value={arizaForm.tarih}
                    onChange={e => setArizaForm(f => ({ ...f, tarih: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Etki Seviyesi</label>
                  <select className={inputCls} value={arizaForm.etki}
                    onChange={e => setArizaForm(f => ({ ...f, etki: e.target.value as any }))}>
                    {['Düşük', 'Orta', 'Kritik'].map(k => <option key={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Çözüm Süresi (Saat)</label>
                  <input type="number" className={inputCls} value={arizaForm.cozumSuresi}
                    onChange={e => setArizaForm(f => ({ ...f, cozumSuresi: +e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Arıza Açıklaması</label>
                <textarea className={`${inputCls} h-20 resize-none`} value={arizaForm.aciklama}
                  onChange={e => setArizaForm(f => ({ ...f, aciklama: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Çözüm</label>
                <textarea className={`${inputCls} h-16 resize-none`} value={arizaForm.cozum}
                  onChange={e => setArizaForm(f => ({ ...f, cozum: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button onClick={() => setShowArizaModal(false)} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveAriza} className="apple-button-primary text-sm">Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
