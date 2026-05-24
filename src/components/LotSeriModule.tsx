import React, { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Plus, Search, X, Save, AlertTriangle, Package, Hash, Calendar, CheckCircle2 } from 'lucide-react';
import { sortByCreatedAt } from '../utils/fsSort';

interface LotKaydi {
  id: string;
  lotNo: string;
  urunAdi: string;
  urunSku: string;
  miktar: number;
  kalanMiktar: number;
  tedarikci: string;
  uretimTarihi: string;
  sonKullanmaTarihi: string;
  girisDate: string;
  depo: string;
  durum: 'Aktif' | 'Tüketildi' | 'Karantina' | 'İade';
  notlar: string;
  createdAt?: unknown;
}

interface SeriNo {
  id: string;
  seriNo: string;
  urunAdi: string;
  urunSku: string;
  lotNo: string;
  durum: 'Stokta' | 'Satıldı' | 'Servis' | 'İade' | 'Hurda';
  musteriAdi: string;
  satisDate: string;
  garantiBitis: string;
  notlar: string;
  createdAt?: unknown;
}

interface LotHareketi {
  id: string;
  lotNo: string;
  urunAdi: string;
  tip: 'Giriş' | 'Çıkış' | 'Karantina' | 'Transfer';
  miktar: number;
  aciklama: string;
  belgeNo: string;
  tarih: string;
  createdAt?: unknown;
}

export default function LotSeriModule({ currentLanguage, isAuthenticated }: { currentLanguage: string; isAuthenticated: boolean }) {
  const tr = currentLanguage === 'tr';
  const [subTab, setSubTab] = useState<'lot' | 'seri' | 'hareketler' | 'karantina'>('lot');
  const [lotlar, setLotlar] = useState<LotKaydi[]>([]);
  const [seriler, setSeriler] = useState<SeriNo[]>([]);
  const [hareketler, setHareketler] = useState<LotHareketi[]>([]);
  const [search, setSearch] = useState('');
  const [showLotModal, setShowLotModal] = useState(false);
  const [showSeriModal, setShowSeriModal] = useState(false);
  const [showHareketModal, setShowHareketModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const initLot = { lotNo: '', urunAdi: '', urunSku: '', miktar: 0, kalanMiktar: 0, tedarikci: '', uretimTarihi: '', sonKullanmaTarihi: '', girisDate: today, depo: '', durum: 'Aktif' as LotKaydi['durum'], notlar: '' };
  const initSeri = { seriNo: '', urunAdi: '', urunSku: '', lotNo: '', durum: 'Stokta' as SeriNo['durum'], musteriAdi: '', satisDate: '', garantiBitis: '', notlar: '' };
  const initHareket = { lotNo: '', urunAdi: '', tip: 'Çıkış' as LotHareketi['tip'], miktar: 0, aciklama: '', belgeNo: '', tarih: today };

  const [lotForm, setLotForm] = useState(initLot);
  const [seriForm, setSeriForm] = useState(initSeri);
  const [hareketForm, setHareketForm] = useState(initHareket);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'lotKayitlari'), orderBy('girisDate', 'desc')), s =>
      setLotlar(s.docs.map(d => ({ id: d.id, ...d.data() } as LotKaydi))));
    const u2 = onSnapshot(query(collection(db, 'seriNolar')), s =>
      setSeriler(s.docs.map(d => ({ id: d.id, ...d.data() } as SeriNo))));
    const u3 = onSnapshot(query(collection(db, 'lotHareketleri'), orderBy('tarih', 'desc')), s =>
      setHareketler(s.docs.map(d => ({ id: d.id, ...d.data() } as LotHareketi))));
    return () => { u1(); u2(); u3(); };
  }, []);

  const saveLot = async () => {
    if (!lotForm.lotNo || !lotForm.urunAdi) return;
    setIsSubmitting(true);
    try {
      const data = { ...lotForm, kalanMiktar: lotForm.miktar };
      await addDoc(collection(db, 'lotKayitlari'), { ...data, createdAt: serverTimestamp() });
      await addDoc(collection(db, 'lotHareketleri'), {
        lotNo: lotForm.lotNo, urunAdi: lotForm.urunAdi, tip: 'Giriş',
        miktar: lotForm.miktar, aciklama: tr ? 'İlk lot girişi' : 'Initial lot entry',
        belgeNo: '', tarih: lotForm.girisDate, createdAt: serverTimestamp()
      });
      setLotForm(initLot); setShowLotModal(false);
    } finally { setIsSubmitting(false); }
  };

  const saveSeri = async () => {
    if (!seriForm.seriNo || !seriForm.urunAdi) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'seriNolar'), { ...seriForm, createdAt: serverTimestamp() });
      setSeriForm(initSeri); setShowSeriModal(false);
    } finally { setIsSubmitting(false); }
  };

  const saveHareket = async () => {
    if (!hareketForm.lotNo || !hareketForm.miktar) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'lotHareketleri'), { ...hareketForm, createdAt: serverTimestamp() });
      const lot = lotlar.find(l => l.lotNo === hareketForm.lotNo);
      if (lot) {
        const delta = hareketForm.tip === 'Giriş' ? hareketForm.miktar : -hareketForm.miktar;
        await updateDoc(doc(db, 'lotKayitlari', lot.id), { kalanMiktar: Math.max(0, lot.kalanMiktar + delta) });
      }
      setHareketForm(initHareket); setShowHareketModal(false);
    } finally { setIsSubmitting(false); }
  };

  const durumBadge = (d: string) => {
    const map: Record<string, string> = {
      Aktif: 'bg-green-100 text-green-700', Tüketildi: 'bg-gray-200 text-gray-500',
      Karantina: 'bg-red-100 text-red-700', İade: 'bg-purple-100 text-purple-700',
      Stokta: 'bg-blue-100 text-blue-700', Satıldı: 'bg-green-100 text-green-700',
      Servis: 'bg-amber-100 text-amber-700', Hurda: 'bg-gray-200 text-gray-500',
    };
    return `text-xs px-2 py-0.5 rounded-full font-semibold ${map[d] ?? 'bg-gray-100 text-gray-600'}`;
  };

  const expiringSoon = lotlar.filter(l => l.sonKullanmaTarihi && l.sonKullanmaTarihi <= in30 && l.sonKullanmaTarihi >= today && l.durum === 'Aktif');
  const expired = lotlar.filter(l => l.sonKullanmaTarihi && l.sonKullanmaTarihi < today && l.durum === 'Aktif');
  const karantina = lotlar.filter(l => l.durum === 'Karantina');

  const filteredLot = lotlar.filter(l =>
    !search || l.lotNo.toLowerCase().includes(search.toLowerCase()) ||
    l.urunAdi.toLowerCase().includes(search.toLowerCase()) ||
    l.urunSku.toLowerCase().includes(search.toLowerCase())
  );
  const filteredSeri = seriler.filter(s =>
    !search || s.seriNo.toLowerCase().includes(search.toLowerCase()) ||
    s.urunAdi.toLowerCase().includes(search.toLowerCase())
  );

  const tabs = [
    { id: 'lot', label: tr ? 'Lot Takibi' : 'Lot Tracking' },
    { id: 'seri', label: tr ? 'Seri No Takibi' : 'Serial Tracking' },
    { id: 'hareketler', label: tr ? 'Hareketler' : 'Movements' },
    { id: 'karantina', label: tr ? `Karantina${karantina.length > 0 ? ` (${karantina.length})` : ''}` : `Quarantine${karantina.length > 0 ? ` (${karantina.length})` : ''}` },
  ] as const;

  const kpis = [
    { label: tr ? 'Aktif Lot' : 'Active Lots', val: lotlar.filter(l => l.durum === 'Aktif').length, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: tr ? 'Yakında Biten SKT' : 'Expiring Soon', val: expiringSoon.length, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: tr ? 'Süresi Geçmiş' : 'Expired', val: expired.length, color: 'text-red-600', bg: 'bg-red-50' },
    { label: tr ? 'Kayıtlı Seri No' : 'Serial Nos.', val: seriler.length, color: 'text-purple-600', bg: 'bg-purple-50' },
  ];

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(k => (
          <div key={k.label} className={`apple-card flex items-center gap-3 p-4 ${k.bg}`}>
            <div><p className="text-xs text-gray-500">{k.label}</p><p className={`text-2xl font-bold ${k.color}`}>{k.val}</p></div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {(expired.length > 0 || expiringSoon.length > 0) && (
        <div className="space-y-2">
          {expired.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-sm font-semibold text-red-800">{expired.length} {tr ? 'lot SKT geçti!' : 'lot(s) have expired!'} — {expired.map(l => l.lotNo).join(', ')}</p>
            </div>
          )}
          {expiringSoon.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-sm font-semibold text-amber-800">{expiringSoon.length} {tr ? 'lot 30 gün içinde SKT dolacak' : 'lot(s) expiring within 30 days'}</p>
            </div>
          )}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="overflow-x-auto scrollbar-none">
        <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className={`shrink-0 inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${subTab === t.id ? 'bg-brand text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      {(subTab === 'lot' || subTab === 'seri') && (
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={tr ? 'Lot/SKU/Ürün ara...' : 'Search lot/SKU/product...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="apple-input pl-9 text-sm"
          />
        </div>
      )}

      {/* LOT TAB */}
      {subTab === 'lot' && (
        <div className="apple-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900">{tr ? 'Lot Kayıtları' : 'Lot Records'}</h3>
            {isAuthenticated && (
              <div className="flex gap-2">
                <button onClick={() => setShowHareketModal(true)} className="apple-button-secondary flex items-center gap-1.5 text-sm">
                  <Hash className="w-3.5 h-3.5" />{tr ? 'Hareket Ekle' : 'Add Movement'}
                </button>
                <button onClick={() => setShowLotModal(true)} className="apple-button-primary flex items-center gap-1.5 text-sm">
                  <Plus className="w-4 h-4" />{tr ? 'Lot Ekle' : 'Add Lot'}
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-xs text-gray-500 uppercase">
                <th className="text-left py-2">{tr ? 'Lot No' : 'Lot No'}</th>
                <th className="text-left py-2">{tr ? 'Ürün' : 'Product'}</th>
                <th className="text-right py-2">{tr ? 'Miktar' : 'Qty'}</th>
                <th className="text-right py-2">{tr ? 'Kalan' : 'Remaining'}</th>
                <th className="text-left py-2 hidden md:table-cell">{tr ? 'SKT' : 'Expiry'}</th>
                <th className="text-left py-2 hidden md:table-cell">{tr ? 'Giriş' : 'Received'}</th>
                <th className="text-center py-2">{tr ? 'Durum' : 'Status'}</th>
              </tr></thead>
              <tbody>
                {filteredLot.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">{tr ? 'Lot kaydı yok' : 'No lots found'}</td></tr>}
                {filteredLot.map(l => {
                  const isExpired = l.sonKullanmaTarihi && l.sonKullanmaTarihi < today;
                  const isExpiring = !isExpired && l.sonKullanmaTarihi && l.sonKullanmaTarihi <= in30;
                  return (
                    <tr key={l.id} className={`border-b border-gray-50 hover:bg-gray-50 ${isExpired ? 'bg-red-50/30' : isExpiring ? 'bg-amber-50/30' : ''}`}>
                      <td className="py-2 font-mono font-semibold text-brand">{l.lotNo}</td>
                      <td className="py-2">
                        <p className="font-semibold text-gray-900">{l.urunAdi}</p>
                        <p className="text-xs text-gray-400">{l.urunSku}</p>
                      </td>
                      <td className="py-2 text-right font-semibold">{l.miktar.toLocaleString('tr-TR')}</td>
                      <td className="py-2 text-right">
                        <span className={`font-bold ${l.kalanMiktar === 0 ? 'text-gray-400' : 'text-emerald-600'}`}>{l.kalanMiktar.toLocaleString('tr-TR')}</span>
                      </td>
                      <td className="py-2 hidden md:table-cell">
                        {l.sonKullanmaTarihi ? (
                          <span className={`text-xs font-semibold ${isExpired ? 'text-red-600' : isExpiring ? 'text-amber-600' : 'text-gray-600'}`}>
                            {new Date(l.sonKullanmaTarihi).toLocaleDateString('tr-TR')}
                            {isExpired && ' ⚠️'}
                            {isExpiring && !isExpired && ' ⏰'}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 hidden md:table-cell text-gray-500 text-xs">{l.girisDate}</td>
                      <td className="py-2 text-center"><span className={durumBadge(l.durum)}>{l.durum}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SERİ NO TAB */}
      {subTab === 'seri' && (
        <div className="apple-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900">{tr ? 'Seri Numara Kayıtları' : 'Serial Number Records'}</h3>
            {isAuthenticated && (
              <button onClick={() => setShowSeriModal(true)} className="apple-button-primary flex items-center gap-1.5 text-sm">
                <Plus className="w-4 h-4" />{tr ? 'Seri No Ekle' : 'Add Serial No'}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-xs text-gray-500 uppercase">
                <th className="text-left py-2">{tr ? 'Seri No' : 'Serial No'}</th>
                <th className="text-left py-2">{tr ? 'Ürün' : 'Product'}</th>
                <th className="text-left py-2 hidden md:table-cell">{tr ? 'Lot No' : 'Lot No'}</th>
                <th className="text-left py-2 hidden md:table-cell">{tr ? 'Müşteri' : 'Customer'}</th>
                <th className="text-left py-2 hidden lg:table-cell">{tr ? 'Garanti Bitiş' : 'Warranty End'}</th>
                <th className="text-center py-2">{tr ? 'Durum' : 'Status'}</th>
              </tr></thead>
              <tbody>
                {filteredSeri.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">{tr ? 'Seri no kaydı yok' : 'No serial numbers found'}</td></tr>}
                {filteredSeri.map(s => {
                  const garantiExpired = s.garantiBitis && s.garantiBitis < today;
                  return (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 font-mono font-semibold text-brand">{s.seriNo}</td>
                      <td className="py-2">
                        <p className="font-semibold">{s.urunAdi}</p>
                        <p className="text-xs text-gray-400">{s.urunSku}</p>
                      </td>
                      <td className="py-2 hidden md:table-cell text-gray-500 font-mono text-xs">{s.lotNo || '—'}</td>
                      <td className="py-2 hidden md:table-cell text-gray-600">{s.musteriAdi || '—'}</td>
                      <td className="py-2 hidden lg:table-cell">
                        {s.garantiBitis ? (
                          <span className={`text-xs font-semibold ${garantiExpired ? 'text-red-500' : 'text-gray-600'}`}>
                            {new Date(s.garantiBitis).toLocaleDateString('tr-TR')}
                            {garantiExpired && ' (Sona erdi)'}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2 text-center"><span className={durumBadge(s.durum)}>{s.durum}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HAREKETLER TAB */}
      {subTab === 'hareketler' && (
        <div className="apple-card p-5 overflow-hidden">
          <h3 className="font-bold text-gray-900 mb-4">{tr ? 'Lot Hareketleri' : 'Lot Movements'}</h3>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500 uppercase">
              <th className="text-left py-2">{tr ? 'Tarih' : 'Date'}</th>
              <th className="text-left py-2">{tr ? 'Lot No' : 'Lot No'}</th>
              <th className="text-left py-2">{tr ? 'Ürün' : 'Product'}</th>
              <th className="text-left py-2">{tr ? 'Tip' : 'Type'}</th>
              <th className="text-right py-2">{tr ? 'Miktar' : 'Qty'}</th>
              <th className="text-left py-2 hidden md:table-cell">{tr ? 'Açıklama' : 'Description'}</th>
            </tr></thead>
            <tbody>
              {hareketler.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">{tr ? 'Hareket yok' : 'No movements'}</td></tr>}
              {hareketler.map(h => (
                <tr key={h.id} className="border-b border-gray-50">
                  <td className="py-2 text-gray-500">{h.tarih}</td>
                  <td className="py-2 font-mono font-semibold text-brand text-xs">{h.lotNo}</td>
                  <td className="py-2">{h.urunAdi}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${h.tip === 'Giriş' ? 'bg-green-100 text-green-700' : h.tip === 'Çıkış' ? 'bg-red-100 text-red-700' : h.tip === 'Karantina' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{h.tip}</span>
                  </td>
                  <td className={`py-2 text-right font-semibold ${h.tip === 'Giriş' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {h.tip === 'Giriş' ? '+' : '-'}{h.miktar}
                  </td>
                  <td className="py-2 text-gray-500 hidden md:table-cell truncate max-w-xs">{h.aciklama}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* KARANTİNA TAB */}
      {subTab === 'karantina' && (
        <div className="apple-card p-5">
          <h3 className="font-bold text-gray-900 mb-4">{tr ? 'Karantina Lotları' : 'Quarantined Lots'}</h3>
          {karantina.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-12 h-12 text-green-200 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">{tr ? 'Karantinada lot yok' : 'No lots in quarantine'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {karantina.map(l => (
                <div key={l.id} className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-brand font-mono">{l.lotNo}</p>
                      <p className="text-sm text-gray-700">{l.urunAdi} · {l.urunSku}</p>
                      <p className="text-xs text-gray-500 mt-1">{tr ? 'Kalan:' : 'Remaining:'} {l.kalanMiktar} / {l.miktar} &nbsp;•&nbsp; {tr ? 'Depo:' : 'Warehouse:'} {l.depo}</p>
                    </div>
                    {isAuthenticated && (
                      <div className="flex flex-col gap-2">
                        <button onClick={() => updateDoc(doc(db, 'lotKayitlari', l.id), { durum: 'Aktif' })}
                          className="text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-full font-semibold hover:bg-green-200">
                          {tr ? 'Serbest Bırak' : 'Release'}
                        </button>
                        <button onClick={() => updateDoc(doc(db, 'lotKayitlari', l.id), { durum: 'İade' })}
                          className="text-xs px-3 py-1.5 bg-purple-100 text-purple-700 rounded-full font-semibold hover:bg-purple-200">
                          {tr ? 'İadeye Al' : 'Return'}
                        </button>
                      </div>
                    )}
                  </div>
                  {l.notlar && <p className="text-xs text-red-700 mt-2 italic">{l.notlar}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LOT MODAL */}
      {showLotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{tr ? 'Lot Ekle' : 'Add Lot'}</h3>
              <button onClick={() => setShowLotModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder={tr ? 'Lot No *' : 'Lot No *'} value={lotForm.lotNo} onChange={e => setLotForm(p => ({ ...p, lotNo: e.target.value }))} className="apple-input" />
              <input placeholder={tr ? 'Ürün Adı *' : 'Product Name *'} value={lotForm.urunAdi} onChange={e => setLotForm(p => ({ ...p, urunAdi: e.target.value }))} className="apple-input" />
              <input placeholder="SKU" value={lotForm.urunSku} onChange={e => setLotForm(p => ({ ...p, urunSku: e.target.value }))} className="apple-input" />
              <input type="number" placeholder={tr ? 'Miktar' : 'Quantity'} value={lotForm.miktar || ''} onChange={e => setLotForm(p => ({ ...p, miktar: Number(e.target.value) }))} className="apple-input" />
              <input placeholder={tr ? 'Tedarikçi' : 'Supplier'} value={lotForm.tedarikci} onChange={e => setLotForm(p => ({ ...p, tedarikci: e.target.value }))} className="apple-input" />
              <input placeholder={tr ? 'Depo' : 'Warehouse'} value={lotForm.depo} onChange={e => setLotForm(p => ({ ...p, depo: e.target.value }))} className="apple-input" />
              <div className="space-y-1">
                <label className="text-xs text-gray-500">{tr ? 'Üretim Tarihi' : 'Production Date'}</label>
                <input type="date" value={lotForm.uretimTarihi} onChange={e => setLotForm(p => ({ ...p, uretimTarihi: e.target.value }))} className="apple-input" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">{tr ? 'Son Kullanma Tarihi' : 'Expiry Date'}</label>
                <input type="date" value={lotForm.sonKullanmaTarihi} onChange={e => setLotForm(p => ({ ...p, sonKullanmaTarihi: e.target.value }))} className="apple-input" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">{tr ? 'Giriş Tarihi' : 'Received Date'}</label>
                <input type="date" value={lotForm.girisDate} onChange={e => setLotForm(p => ({ ...p, girisDate: e.target.value }))} className="apple-input" />
              </div>
              <select value={lotForm.durum} onChange={e => setLotForm(p => ({ ...p, durum: e.target.value as LotKaydi['durum'] }))} className="apple-input">
                <option>Aktif</option><option>Karantina</option>
              </select>
            </div>
            <textarea placeholder={tr ? 'Notlar' : 'Notes'} value={lotForm.notlar} onChange={e => setLotForm(p => ({ ...p, notlar: e.target.value }))} className="apple-input resize-none w-full" rows={2} />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowLotModal(false)} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveLot} disabled={isSubmitting} className="apple-button-primary flex items-center gap-2 text-sm"><Save className="w-4 h-4" />{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* SERİ NO MODAL */}
      {showSeriModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{tr ? 'Seri No Ekle' : 'Add Serial No'}</h3>
              <button onClick={() => setShowSeriModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder={tr ? 'Seri No *' : 'Serial No *'} value={seriForm.seriNo} onChange={e => setSeriForm(p => ({ ...p, seriNo: e.target.value }))} className="apple-input" />
              <input placeholder={tr ? 'Ürün Adı *' : 'Product *'} value={seriForm.urunAdi} onChange={e => setSeriForm(p => ({ ...p, urunAdi: e.target.value }))} className="apple-input" />
              <input placeholder="SKU" value={seriForm.urunSku} onChange={e => setSeriForm(p => ({ ...p, urunSku: e.target.value }))} className="apple-input" />
              <input placeholder="Lot No" value={seriForm.lotNo} onChange={e => setSeriForm(p => ({ ...p, lotNo: e.target.value }))} className="apple-input" />
              <input placeholder={tr ? 'Müşteri (satışta)' : 'Customer (on sale)'} value={seriForm.musteriAdi} onChange={e => setSeriForm(p => ({ ...p, musteriAdi: e.target.value }))} className="apple-input" />
              <select value={seriForm.durum} onChange={e => setSeriForm(p => ({ ...p, durum: e.target.value as SeriNo['durum'] }))} className="apple-input">
                <option>Stokta</option><option>Satıldı</option><option>Servis</option><option>İade</option><option>Hurda</option>
              </select>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">{tr ? 'Satış Tarihi' : 'Sale Date'}</label>
                <input type="date" value={seriForm.satisDate} onChange={e => setSeriForm(p => ({ ...p, satisDate: e.target.value }))} className="apple-input" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">{tr ? 'Garanti Bitiş' : 'Warranty End'}</label>
                <input type="date" value={seriForm.garantiBitis} onChange={e => setSeriForm(p => ({ ...p, garantiBitis: e.target.value }))} className="apple-input" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSeriModal(false)} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveSeri} disabled={isSubmitting} className="apple-button-primary text-sm">{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* HAREKET MODAL */}
      {showHareketModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">{tr ? 'Lot Hareketi' : 'Lot Movement'}</h3>
              <button onClick={() => setShowHareketModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <select value={hareketForm.lotNo} onChange={e => {
                const lot = lotlar.find(l => l.lotNo === e.target.value);
                setHareketForm(p => ({ ...p, lotNo: e.target.value, urunAdi: lot?.urunAdi ?? '' }));
              }} className="apple-input">
                <option value="">{tr ? 'Lot Seçin' : 'Select Lot'}</option>
                {lotlar.filter(l => l.durum === 'Aktif').map(l => <option key={l.id} value={l.lotNo}>{l.lotNo} — {l.urunAdi} ({tr ? 'Kalan:' : 'Rem:'} {l.kalanMiktar})</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <select value={hareketForm.tip} onChange={e => setHareketForm(p => ({ ...p, tip: e.target.value as LotHareketi['tip'] }))} className="apple-input">
                  <option>Giriş</option><option>Çıkış</option><option>Karantina</option><option>Transfer</option>
                </select>
                <input type="number" placeholder={tr ? 'Miktar' : 'Qty'} value={hareketForm.miktar || ''} onChange={e => setHareketForm(p => ({ ...p, miktar: Number(e.target.value) }))} className="apple-input" />
              </div>
              <input placeholder={tr ? 'Açıklama' : 'Description'} value={hareketForm.aciklama} onChange={e => setHareketForm(p => ({ ...p, aciklama: e.target.value }))} className="apple-input" />
              <div className="grid grid-cols-2 gap-3">
                <input placeholder={tr ? 'Belge No' : 'Doc No'} value={hareketForm.belgeNo} onChange={e => setHareketForm(p => ({ ...p, belgeNo: e.target.value }))} className="apple-input" />
                <input type="date" value={hareketForm.tarih} onChange={e => setHareketForm(p => ({ ...p, tarih: e.target.value }))} className="apple-input" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowHareketModal(false)} className="apple-button-secondary text-sm">İptal</button>
              <button onClick={saveHareket} disabled={isSubmitting} className="apple-button-primary text-sm">{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
