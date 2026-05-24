import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc,
  doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import { db } from '../firebase';
import { sortByCreatedAt } from '../utils/fsSort';
import {
  Globe, Package, CreditCard, FileText, Plus, X,
  TrendingUp, Clock, CheckCircle, AlertCircle, Ship
} from 'lucide-react';

interface Ihracat {
  id: string;
  ihracatNo: string;
  aliciFirma: string;
  ulke: string;
  urun: string;
  miktar: number;
  tutar: number;
  doviz: 'USD' | 'EUR';
  incoterm: string;
  hsKodu: string;
  sevkTarihi: string;
  gumrukDurumu: string;
  notlar: string;
  createdAt?: any;
}

interface Ithalat {
  id: string;
  ithalatNo: string;
  tedarikci: string;
  cikisUlkesi: string;
  urun: string;
  miktar: number;
  tutar: number;
  doviz: 'USD' | 'EUR';
  incoterm: string;
  hsKodu: string;
  tahminiVarisTarihi: string;
  gumrukVergi: number;
  kdv: number;
  gumrukDurumu: string;
  notlar: string;
  createdAt?: any;
}

interface Akreditif {
  id: string;
  akreditifNo: string;
  banka: string;
  lehdarAmir: string;
  tutar: number;
  doviz: 'USD' | 'EUR';
  vadesi: string;
  tur: 'İhracat' | 'İthalat';
  durum: string;
  createdAt?: any;
}

interface GumrukBeyanname {
  id: string;
  beyanNo: string;
  rejim: string;
  tarih: string;
  deger: number;
  gumrukMusaviri: string;
  durum: string;
  createdAt?: any;
}

const INCOTERMLER = ['EXW', 'FOB', 'CIF', 'DDP', 'DAP', 'FCA', 'CPT', 'CIP'];
const GUMRUK_DURUMLARI = ['Bekliyor', 'Gümrükte', 'Tamamlandı', 'İptal'];
const REJIMLER = ['İhracat', 'İthalat', 'Transit'];

function statusBadge(durum: string) {
  const map: Record<string, string> = {
    'Bekliyor': 'bg-amber-100 text-amber-700',
    'Gümrükte': 'bg-blue-100 text-blue-700',
    'Tamamlandı': 'bg-green-100 text-green-700',
    'İptal': 'bg-red-100 text-red-700',
    'Açıldı': 'bg-blue-100 text-blue-700',
    'Kullanıldı': 'bg-green-100 text-green-700',
    'Süresi Doldu': 'bg-red-100 text-red-700',
  };
  return `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[durum] ?? 'bg-gray-100 text-gray-600'}`;
}

export default function IhracatModule({ currentLanguage, isAuthenticated }: { currentLanguage: string; isAuthenticated: boolean }) {
  const [activeTab, setActiveTab] = useState<'ihracat' | 'ithalat' | 'akreditif' | 'gumruk'>('ihracat');
  const [ihracatlar, setIhracatlar] = useState<Ihracat[]>([]);
  const [ithalatlar, setIthalatlar] = useState<Ithalat[]>([]);
  const [akreditifler, setAkreditifler] = useState<Akreditif[]>([]);
  const [beyannameler, setBeyannameler] = useState<GumrukBeyanname[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Ihracat form state
  const emptyIhr = { aliciFirma: '', ulke: '', urun: '', miktar: '', tutar: '', doviz: 'USD' as const, incoterm: 'FOB', hsKodu: '', sevkTarihi: '', gumrukDurumu: 'Bekliyor', notlar: '' };
  const [ihrForm, setIhrForm] = useState(emptyIhr);

  // Ithalat form state
  const emptyIth = { tedarikci: '', cikisUlkesi: '', urun: '', miktar: '', tutar: '', doviz: 'USD' as const, incoterm: 'CIF', hsKodu: '', tahminiVarisTarihi: '', gumrukVergi: '', kdv: '', gumrukDurumu: 'Bekliyor', notlar: '' };
  const [ithForm, setIthForm] = useState(emptyIth);

  // Akreditif form state
  const emptyAkr = { banka: '', lehdarAmir: '', tutar: '', doviz: 'USD' as const, vadesi: '', tur: 'İhracat' as const, durum: 'Açıldı' };
  const [akrForm, setAkrForm] = useState(emptyAkr);

  // Gumruk form state
  const emptyBey = { beyanNo: '', rejim: 'İhracat', tarih: '', deger: '', gumrukMusaviri: '', durum: 'Bekliyor' };
  const [beyForm, setBeyForm] = useState(emptyBey);

  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'ihracatlar')), snap =>
        setIhracatlar(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ihracat))))),
      onSnapshot(query(collection(db, 'ithalatlar')), snap =>
        setIthalatlar(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ithalat))))),
      onSnapshot(query(collection(db, 'akreditifler')), snap =>
        setAkreditifler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as Akreditif))))),
      onSnapshot(query(collection(db, 'gumrukBeyannameleri')), snap =>
        setBeyannameler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as GumrukBeyanname))))),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  const autoNo = (prefix: string, list: any[]) =>
    `${prefix}-2026-${String(list.length + 1).padStart(4, '0')}`;

  async function saveIhracat() {
    if (!ihrForm.aliciFirma || !ihrForm.ulke) return;
    setSaving(true);
    await addDoc(collection(db, 'ihracatlar'), {
      ...ihrForm,
      ihracatNo: autoNo('EX', ihracatlar),
      miktar: Number(ihrForm.miktar),
      tutar: Number(ihrForm.tutar),
      createdAt: serverTimestamp(),
    });
    setIhrForm(emptyIhr);
    setShowModal(false);
    setSaving(false);
  }

  async function saveIthalat() {
    if (!ithForm.tedarikci || !ithForm.cikisUlkesi) return;
    setSaving(true);
    await addDoc(collection(db, 'ithalatlar'), {
      ...ithForm,
      ithalatNo: autoNo('IT', ithalatlar),
      miktar: Number(ithForm.miktar),
      tutar: Number(ithForm.tutar),
      gumrukVergi: Number(ithForm.gumrukVergi),
      kdv: Number(ithForm.kdv),
      createdAt: serverTimestamp(),
    });
    setIthForm(emptyIth);
    setShowModal(false);
    setSaving(false);
  }

  async function saveAkreditif() {
    if (!akrForm.banka || !akrForm.lehdarAmir) return;
    setSaving(true);
    await addDoc(collection(db, 'akreditifler'), {
      ...akrForm,
      akreditifNo: autoNo('AKR', akreditifler),
      tutar: Number(akrForm.tutar),
      createdAt: serverTimestamp(),
    });
    setAkrForm(emptyAkr);
    setShowModal(false);
    setSaving(false);
  }

  async function saveBeyanname() {
    if (!beyForm.beyanNo || !beyForm.gumrukMusaviri) return;
    setSaving(true);
    await addDoc(collection(db, 'gumrukBeyannameleri'), {
      ...beyForm,
      deger: Number(beyForm.deger),
      createdAt: serverTimestamp(),
    });
    setBeyForm(emptyBey);
    setShowModal(false);
    setSaving(false);
  }

  const ihracatToplam = ihracatlar.reduce((s, i) => s + (i.tutar || 0), 0);
  const bekleyenGumruk = ihracatlar.filter(i => i.gumrukDurumu === 'Bekliyor' || i.gumrukDurumu === 'Gümrükte').length;

  const tabs = [
    { key: 'ihracat', label: 'İhracat', icon: Ship },
    { key: 'ithalat', label: 'İthalat', icon: Package },
    { key: 'akreditif', label: 'Akreditif', icon: CreditCard },
    { key: 'gumruk', label: 'Gümrük', icon: FileText },
  ] as const;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      {activeTab === 'ihracat' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Toplam İhracat', value: ihracatlar.length, color: 'text-brand' },
            { label: 'Aylık Tutar (USD)', value: `$${ihracatToplam.toLocaleString()}`, color: 'text-green-600' },
            { label: 'Bekleyen Gümrük', value: bekleyenGumruk, color: 'text-amber-600' },
            { label: 'Ort. Teslimat (gün)', value: '14', color: 'text-blue-600' },
          ].map(kpi => (
            <div key={kpi.label} className="apple-card p-4 text-center">
              <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{kpi.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + Add */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
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
        <button onClick={() => setShowModal(true)} className="apple-button-primary flex items-center gap-2 shrink-0">
          <Plus className="w-4 h-4" /> {currentLanguage === 'tr' ? 'Yeni Ekle' : 'Add New'}
        </button>
      </div>

      {/* İhracat Tab */}
      {activeTab === 'ihracat' && (
        <div className="apple-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['İhracat No', 'Alıcı Firma', 'Ülke', 'Ürün', 'Miktar', 'Tutar', 'Incoterm', 'HS Kodu', 'Sevk Tarihi', 'Durum'].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ihracatlar.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-gray-400 text-sm">Henüz ihracat kaydı yok</td></tr>
              )}
              {ihracatlar.map(i => (
                <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-3 font-mono text-xs text-brand font-semibold">{i.ihracatNo}</td>
                  <td className="py-3 px-3 font-medium text-gray-900">{i.aliciFirma}</td>
                  <td className="py-3 px-3 text-gray-600">{i.ulke}</td>
                  <td className="py-3 px-3 text-gray-600">{i.urun}</td>
                  <td className="py-3 px-3 text-gray-600">{i.miktar}</td>
                  <td className="py-3 px-3 font-semibold text-gray-900">{i.doviz} {i.tutar?.toLocaleString()}</td>
                  <td className="py-3 px-3"><span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">{i.incoterm}</span></td>
                  <td className="py-3 px-3 font-mono text-xs text-gray-500">{i.hsKodu}</td>
                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap">{i.sevkTarihi}</td>
                  <td className="py-3 px-3"><span className={statusBadge(i.gumrukDurumu)}>{i.gumrukDurumu}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* İthalat Tab */}
      {activeTab === 'ithalat' && (
        <div className="apple-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['İthalat No', 'Tedarikçi', 'Çıkış Ülkesi', 'Ürün', 'Tutar', 'Gümrük Vergi', 'KDV', 'Tahmini Varış', 'Durum'].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ithalatlar.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400 text-sm">Henüz ithalat kaydı yok</td></tr>
              )}
              {ithalatlar.map(i => (
                <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-3 font-mono text-xs text-brand font-semibold">{i.ithalatNo}</td>
                  <td className="py-3 px-3 font-medium text-gray-900">{i.tedarikci}</td>
                  <td className="py-3 px-3 text-gray-600">{i.cikisUlkesi}</td>
                  <td className="py-3 px-3 text-gray-600">{i.urun}</td>
                  <td className="py-3 px-3 font-semibold">{i.doviz} {i.tutar?.toLocaleString()}</td>
                  <td className="py-3 px-3 text-gray-600">₺ {i.gumrukVergi?.toLocaleString()}</td>
                  <td className="py-3 px-3 text-gray-600">₺ {i.kdv?.toLocaleString()}</td>
                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap">{i.tahminiVarisTarihi}</td>
                  <td className="py-3 px-3"><span className={statusBadge(i.gumrukDurumu)}>{i.gumrukDurumu}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Akreditif Tab */}
      {activeTab === 'akreditif' && (
        <div className="apple-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Akreditif No', 'Banka', 'Lehdar / Amir', 'Tutar', 'Vadesi', 'Tür', 'Durum'].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {akreditifler.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400 text-sm">Henüz akreditif kaydı yok</td></tr>
              )}
              {akreditifler.map(a => (
                <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-3 font-mono text-xs text-brand font-semibold">{a.akreditifNo}</td>
                  <td className="py-3 px-3 font-medium text-gray-900">{a.banka}</td>
                  <td className="py-3 px-3 text-gray-600">{a.lehdarAmir}</td>
                  <td className="py-3 px-3 font-semibold">{a.doviz} {a.tutar?.toLocaleString()}</td>
                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap">{a.vadesi}</td>
                  <td className="py-3 px-3"><span className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full font-medium">{a.tur}</span></td>
                  <td className="py-3 px-3"><span className={statusBadge(a.durum)}>{a.durum}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Gümrük Tab */}
      {activeTab === 'gumruk' && (
        <div className="apple-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Beyanname No', 'Rejim', 'Tarih', 'Değer (₺)', 'Gümrük Müşaviri', 'Durum'].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {beyannameler.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">Henüz beyanname kaydı yok</td></tr>
              )}
              {beyannameler.map(b => (
                <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-3 font-mono text-xs text-brand font-semibold">{b.beyanNo}</td>
                  <td className="py-3 px-3"><span className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full font-medium">{b.rejim}</span></td>
                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap">{b.tarih}</td>
                  <td className="py-3 px-3 font-semibold text-gray-900">₺ {Number(b.deger).toLocaleString()}</td>
                  <td className="py-3 px-3 text-gray-600">{b.gumrukMusaviri}</td>
                  <td className="py-3 px-3"><span className={statusBadge(b.durum)}>{b.durum}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">
                {activeTab === 'ihracat' ? 'Yeni İhracat' : activeTab === 'ithalat' ? 'Yeni İthalat' : activeTab === 'akreditif' ? 'Yeni Akreditif' : 'Yeni Beyanname'}
              </h3>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {activeTab === 'ihracat' && (
                <>
                  {[
                    { label: 'Alıcı Firma *', key: 'aliciFirma', type: 'text' },
                    { label: 'Ülke *', key: 'ulke', type: 'text' },
                    { label: 'Ürün / Açıklama', key: 'urun', type: 'text' },
                    { label: 'Miktar', key: 'miktar', type: 'number' },
                    { label: 'Tutar', key: 'tutar', type: 'number' },
                    { label: 'HS Kodu', key: 'hsKodu', type: 'text' },
                    { label: 'Sevk Tarihi', key: 'sevkTarihi', type: 'date' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                      <input type={f.type} value={(ihrForm as any)[f.key]} onChange={e => setIhrForm(p => ({ ...p, [f.key]: e.target.value }))} className="apple-input" />
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Döviz</label>
                      <select value={ihrForm.doviz} onChange={e => setIhrForm(p => ({ ...p, doviz: e.target.value as any }))} className="apple-input">
                        <option>USD</option><option>EUR</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Incoterm</label>
                      <select value={ihrForm.incoterm} onChange={e => setIhrForm(p => ({ ...p, incoterm: e.target.value }))} className="apple-input">
                        {INCOTERMLER.map(i => <option key={i}>{i}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Gümrük Durumu</label>
                    <select value={ihrForm.gumrukDurumu} onChange={e => setIhrForm(p => ({ ...p, gumrukDurumu: e.target.value }))} className="apple-input">
                      {GUMRUK_DURUMLARI.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Notlar</label>
                    <textarea value={ihrForm.notlar} onChange={e => setIhrForm(p => ({ ...p, notlar: e.target.value }))} className="apple-input resize-none" rows={2} />
                  </div>
                  <button onClick={saveIhracat} disabled={saving} className="apple-button-primary w-full">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
                </>
              )}
              {activeTab === 'ithalat' && (
                <>
                  {[
                    { label: 'Tedarikçi Firma *', key: 'tedarikci', type: 'text' },
                    { label: 'Çıkış Ülkesi *', key: 'cikisUlkesi', type: 'text' },
                    { label: 'Ürün / Açıklama', key: 'urun', type: 'text' },
                    { label: 'Miktar', key: 'miktar', type: 'number' },
                    { label: 'Tutar', key: 'tutar', type: 'number' },
                    { label: 'Gümrük Vergi (₺)', key: 'gumrukVergi', type: 'number' },
                    { label: 'KDV (₺)', key: 'kdv', type: 'number' },
                    { label: 'HS Kodu', key: 'hsKodu', type: 'text' },
                    { label: 'Tahmini Varış Tarihi', key: 'tahminiVarisTarihi', type: 'date' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                      <input type={f.type} value={(ithForm as any)[f.key]} onChange={e => setIthForm(p => ({ ...p, [f.key]: e.target.value }))} className="apple-input" />
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Döviz</label>
                      <select value={ithForm.doviz} onChange={e => setIthForm(p => ({ ...p, doviz: e.target.value as any }))} className="apple-input">
                        <option>USD</option><option>EUR</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Incoterm</label>
                      <select value={ithForm.incoterm} onChange={e => setIthForm(p => ({ ...p, incoterm: e.target.value }))} className="apple-input">
                        {INCOTERMLER.map(i => <option key={i}>{i}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Gümrük Durumu</label>
                    <select value={ithForm.gumrukDurumu} onChange={e => setIthForm(p => ({ ...p, gumrukDurumu: e.target.value }))} className="apple-input">
                      {GUMRUK_DURUMLARI.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <button onClick={saveIthalat} disabled={saving} className="apple-button-primary w-full">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
                </>
              )}
              {activeTab === 'akreditif' && (
                <>
                  {[
                    { label: 'Banka *', key: 'banka', type: 'text' },
                    { label: 'Lehdar / Amir *', key: 'lehdarAmir', type: 'text' },
                    { label: 'Tutar', key: 'tutar', type: 'number' },
                    { label: 'Vadesi', key: 'vadesi', type: 'date' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                      <input type={f.type} value={(akrForm as any)[f.key]} onChange={e => setAkrForm(p => ({ ...p, [f.key]: e.target.value }))} className="apple-input" />
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Döviz</label>
                      <select value={akrForm.doviz} onChange={e => setAkrForm(p => ({ ...p, doviz: e.target.value as any }))} className="apple-input">
                        <option>USD</option><option>EUR</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Tür</label>
                      <select value={akrForm.tur} onChange={e => setAkrForm(p => ({ ...p, tur: e.target.value as any }))} className="apple-input">
                        <option>İhracat</option><option>İthalat</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Durum</label>
                      <select value={akrForm.durum} onChange={e => setAkrForm(p => ({ ...p, durum: e.target.value }))} className="apple-input">
                        <option>Açıldı</option><option>Kullanıldı</option><option>Süresi Doldu</option>
                      </select>
                    </div>
                  </div>
                  <button onClick={saveAkreditif} disabled={saving} className="apple-button-primary w-full">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
                </>
              )}
              {activeTab === 'gumruk' && (
                <>
                  {[
                    { label: 'Beyanname No *', key: 'beyanNo', type: 'text' },
                    { label: 'Gümrük Müşaviri *', key: 'gumrukMusaviri', type: 'text' },
                    { label: 'Değer (₺)', key: 'deger', type: 'number' },
                    { label: 'Tarih', key: 'tarih', type: 'date' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                      <input type={f.type} value={(beyForm as any)[f.key]} onChange={e => setBeyForm(p => ({ ...p, [f.key]: e.target.value }))} className="apple-input" />
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Rejim</label>
                      <select value={beyForm.rejim} onChange={e => setBeyForm(p => ({ ...p, rejim: e.target.value }))} className="apple-input">
                        {REJIMLER.map(r => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Durum</label>
                      <select value={beyForm.durum} onChange={e => setBeyForm(p => ({ ...p, durum: e.target.value }))} className="apple-input">
                        {GUMRUK_DURUMLARI.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={saveBeyanname} disabled={saving} className="apple-button-primary w-full">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
