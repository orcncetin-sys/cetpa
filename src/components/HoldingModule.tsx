import { useState, useEffect, useMemo } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp,
} from '../lib/dbClient';
import { db } from '../firebase';
import { Building2, Plus, BarChart3, FileText, ArrowLeftRight, TrendingUp, TrendingDown, Minus, X } from 'lucide-react';

interface HoldingModuleProps {
  currentLanguage: string;
  isAuthenticated: boolean;
  exchangeRates?: Record<string, number> | null;
}

interface Entity {
  id: string;
  name: string;
  taxId: string;
  country: string;
  currency: string;
  ownership: number; // percentage owned by holding
  entityType: 'subsidiary' | 'affiliate' | 'branch';
  active: boolean;
  color: string;
  createdAt: any;
}

interface GLAccount {
  id: string;
  entityId: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode?: string;
  balance: number;
  currency: string;
  updatedAt: any;
}

interface Intercompany {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  description: string;
  amount: number;
  currency: string;
  type: 'loan' | 'trade' | 'dividend' | 'management_fee';
  date: string;
  eliminated: boolean;
  createdAt: any;
}

const COLORS = ['#ff4000','#2563eb','#16a34a','#9333ea','#ea580c','#0891b2'];

const ACCOUNT_TYPES: { value: GLAccount['type']; label: string; sign: 1 | -1 }[] = [
  { value: 'asset', label: 'Varlık / Asset', sign: 1 },
  { value: 'liability', label: 'Borç / Liability', sign: -1 },
  { value: 'equity', label: 'Özkaynak / Equity', sign: -1 },
  { value: 'revenue', label: 'Gelir / Revenue', sign: 1 },
  { value: 'expense', label: 'Gider / Expense', sign: -1 },
];

// `null` = kur verisi olmadigi icin hesaplanamadi. Uydurma sayi yerine '—'.
function fmt(n: number | null, currency = 'TRY') {
  if (n === null) return '—';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n);
}

export default function HoldingModule({ currentLanguage, isAuthenticated, exchangeRates }: HoldingModuleProps) {
  const tr = currentLanguage === 'tr';
  // Konsolidasyon tek raporlama para birimine (₺) çevrilir.
  // KUR UYDURULMAZ (2026-08-26): burada `?? 38` / `?? 41` sabitleri vardı ve 2024'ten kalma
  // kurlarla TÜM konsolide bilanço/gelir tablosu sessizce yanlış çıkıyordu. Kur yoksa `null`
  // döner ve o gösterge '—' olur (CLAUDE.md "sahte kesinlik gösterme").
  const toTRY = (amount: number, currency = 'TRY'): number | null => {
    const amt = Number(amount) || 0;
    if (!currency || currency === 'TRY') return amt;
    const kur = exchangeRates?.[currency];
    if (typeof kur !== 'number' || !isFinite(kur) || kur <= 0) return null;
    return amt * kur;
  };
  // null "bulaşıcıdır": bir kalem çevrilemiyorsa onu içeren toplam da hesaplanamaz.
  const topla = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : a + b;
  const [view, setView] = useState<'entities' | 'coa' | 'intercompany' | 'consolidation'>('entities');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [intercompany, setIntercompany] = useState<Intercompany[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [showEntityForm, setShowEntityForm] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showICForm, setShowICForm] = useState(false);
  const [loading, setLoading] = useState(true);

  // Entity form state
  const [eForm, setEForm] = useState({ name:'', taxId:'', country:'Türkiye', currency:'TRY', ownership:100, entityType:'subsidiary' as Entity['entityType'] });
  // Account form state
  const [aForm, setAForm] = useState({ entityId:'', code:'', name:'', type:'asset' as GLAccount['type'], balance:0, currency:'TRY' });
  // IC form state
  const [icForm, setICForm] = useState({ fromEntityId:'', toEntityId:'', description:'', amount:0, currency:'TRY', type:'trade' as Intercompany['type'], date: new Date().toISOString().split('T')[0] });

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    // Entities
    unsubs.push(onSnapshot(collection(db, 'holdingEntities'), snap => {
      setEntities(snap.docs.map(d => ({ id: d.id, ...d.data() } as Entity)));
      setLoading(false);
    }));
    // Accounts
    unsubs.push(onSnapshot(collection(db, 'holdingAccounts'), snap => {
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as GLAccount)));
    }));
    // Intercompany
    unsubs.push(onSnapshot(collection(db, 'holdingIntercompany'), snap => {
      setIntercompany(snap.docs.map(d => ({ id: d.id, ...d.data() } as Intercompany)));
    }));
    return () => unsubs.forEach(u => u());
  }, []);

  const addEntity = async () => {
    if (!eForm.name.trim()) return;
    const color = COLORS[entities.length % COLORS.length];
    await addDoc(collection(db, 'holdingEntities'), { ...eForm, active: true, color, createdAt: serverTimestamp() });
    setEForm({ name:'', taxId:'', country:'Türkiye', currency:'TRY', ownership:100, entityType:'subsidiary' });
    setShowEntityForm(false);
  };

  const addAccount = async () => {
    if (!aForm.code.trim() || !aForm.name.trim()) return;
    await addDoc(collection(db, 'holdingAccounts'), { ...aForm, updatedAt: serverTimestamp() });
    setAForm({ entityId:'', code:'', name:'', type:'asset', balance:0, currency:'TRY' });
    setShowAccountForm(false);
  };

  const addIC = async () => {
    if (!icForm.fromEntityId || !icForm.toEntityId || icForm.amount <= 0) return;
    await addDoc(collection(db, 'holdingIntercompany'), { ...icForm, eliminated: false, createdAt: serverTimestamp() });
    setICForm({ fromEntityId:'', toEntityId:'', description:'', amount:0, currency:'TRY', type:'trade', date: new Date().toISOString().split('T')[0] });
    setShowICForm(false);
  };

  const toggleEliminate = async (ic: Intercompany) => {
    await updateDoc(doc(db, 'holdingIntercompany', ic.id), { eliminated: !ic.eliminated });
  };

  // Consolidation: aggregate accounts across entities with ownership weighting, eliminate IC
  const consolidation = useMemo(() => {
    const result: Record<GLAccount['type'], { code: string; name: string; balance: number | null; currency: string }[]> = {
      asset: [], liability: [], equity: [], revenue: [], expense: []
    };
    // Group by type+name for consolidation
    const map: Record<string, { balance: number | null; currency: string; type: GLAccount['type']; name: string; code: string }> = {};
    accounts.forEach(a => {
      const entity = entities.find(e => e.id === a.entityId);
      const ownershipFactor = (entity?.ownership ?? 100) / 100;
      const key = `${a.type}||${a.code}||${a.name}`;
      // Tüm bakiyeler ₺'ye çevrilip ağırlıklandırılır (önce karışık para birimi ham toplanıyordu).
      if (!map[key]) map[key] = { balance: 0, currency: 'TRY', type: a.type, name: a.name, code: a.code };
      const tl = toTRY(a.balance, a.currency);
      map[key].balance = topla(map[key].balance, tl === null ? null : tl * ownershipFactor);
    });
    Object.values(map).forEach(item => {
      result[item.type].push({ code: item.code, name: item.name, balance: item.balance, currency: 'TRY' });
    });
    Object.values(result).forEach(arr => arr.sort((a,b) => a.code.localeCompare(b.code)));
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, entities, exchangeRates]);

  // Elimine edilen şirketler-arası işlemler ₺ cinsinden (konsolide varlık+borçtan düşülür).
  const icEliminatedTRY = useMemo<number | null>(
    () => intercompany.filter(ic => ic.eliminated).reduce<number | null>((s, ic) => topla(s, toTRY(ic.amount, ic.currency)), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intercompany, exchangeRates]
  );

  const toplamBakiye = (arr: { balance: number | null }[]): number | null =>
    arr.reduce<number | null>((s, a) => topla(s, a.balance), 0);
  const eksi = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : a - b;

  const totalAssets = eksi(toplamBakiye(consolidation.asset), icEliminatedTRY);
  const totalLiabilities = eksi(toplamBakiye(consolidation.liability), icEliminatedTRY);
  const totalEquity = toplamBakiye(consolidation.equity);
  const totalRevenue = toplamBakiye(consolidation.revenue);
  const totalExpense = toplamBakiye(consolidation.expense);
  const netIncome = eksi(totalRevenue, totalExpense);
  // Net kâr bilinmiyorsa yeşil/kırmızı da yanıltıcı olur — nötr gri.
  const netPozitif: boolean | null = netIncome === null ? null : netIncome >= 0;
  const netRenk = netPozitif === null ? 'text-gray-400' : netPozitif ? 'text-green-600' : 'text-red-500';

  const entityMap = Object.fromEntries(entities.map(e => [e.id, e]));

  const icByEntity = useMemo(() => {
    const totals: Record<string, { receivable: number | null; payable: number | null }> = {};
    intercompany.forEach(ic => {
      if (!totals[ic.fromEntityId]) totals[ic.fromEntityId] = { receivable: 0, payable: 0 };
      if (!totals[ic.toEntityId]) totals[ic.toEntityId] = { receivable: 0, payable: 0 };
      if (!ic.eliminated) {
        const tl = toTRY(ic.amount, ic.currency);
        totals[ic.fromEntityId].receivable = topla(totals[ic.fromEntityId].receivable, tl);
        totals[ic.toEntityId].payable = topla(totals[ic.toEntityId].payable, tl);
      }
    });
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intercompany, exchangeRates]);

  const tabs = [
    { id: 'entities', label: tr ? 'Şirketler' : 'Entities', icon: Building2 },
    { id: 'coa', label: tr ? 'Hesap Planı' : 'Chart of Accounts', icon: FileText },
    { id: 'intercompany', label: tr ? 'Şirketlerarası' : 'Intercompany', icon: ArrowLeftRight },
    { id: 'consolidation', label: tr ? 'Konsolidasyon' : 'Consolidation', icon: BarChart3 },
  ] as const;

  if (!isAuthenticated) return <div className="p-8 text-center text-gray-500">{tr ? 'Lütfen giriş yapın.' : 'Please sign in.'}</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{tr ? 'Holding Yönetimi' : 'Holding Management'}</h1>
            <p className="text-sm text-gray-500">{tr ? 'Çok şirketli konsolidasyon' : 'Multi-entity consolidation'}</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (view === 'entities') setShowEntityForm(true);
            if (view === 'coa') setShowAccountForm(true);
            if (view === 'intercompany') setShowICForm(true);
          }}
          className="apple-button-primary text-white px-4 py-2 rounded-full text-sm flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {view === 'entities' ? (tr ? 'Şirket Ekle' : 'Add Entity') :
           view === 'coa' ? (tr ? 'Hesap Ekle' : 'Add Account') :
           view === 'intercompany' ? (tr ? 'İşlem Ekle' : 'Add Transaction') : ''}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-gray-100 rounded-2xl p-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-sm font-medium transition-all ${view === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ENTITIES VIEW */}
      {view === 'entities' && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="apple-card p-4">
              <p className="text-sm text-gray-500">{tr ? 'Toplam Şirket' : 'Total Entities'}</p>
              <p className="text-2xl font-bold mt-1">{entities.length}</p>
            </div>
            <div className="apple-card p-4">
              <p className="text-sm text-gray-500">{tr ? 'Aktif' : 'Active'}</p>
              <p className="text-2xl font-bold mt-1 text-green-600">{entities.filter(e=>e.active).length}</p>
            </div>
            <div className="apple-card p-4">
              <p className="text-sm text-gray-500">{tr ? 'Ülke' : 'Countries'}</p>
              <p className="text-2xl font-bold mt-1">{new Set(entities.map(e=>e.country)).size}</p>
            </div>
          </div>

          {/* Entity list */}
          <div className="apple-card overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-400">{tr ? 'Yükleniyor...' : 'Loading...'}</div>
            ) : entities.length === 0 ? (
              <div className="p-8 text-center text-gray-400">{tr ? 'Henüz şirket eklenmedi.' : 'No entities added yet.'}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Şirket' : 'Entity'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Tür' : 'Type'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Ülke' : 'Country'}</th>
                    <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Sahiplik %' : 'Ownership %'}</th>
                    <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Alacak (IC)' : 'Receivable (IC)'}</th>
                    <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Borç (IC)' : 'Payable (IC)'}</th>
                  </tr>
                </thead>
                <tbody>
                  {entities.map(e => {
                    const ic = icByEntity[e.id] || { receivable: 0, payable: 0 };
                    return (
                      <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ background: e.color }} />
                            <span className="font-medium">{e.name}</span>
                            {e.taxId && <span className="text-xs text-gray-400">{e.taxId}</span>}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 capitalize">{e.entityType}</span>
                        </td>
                        <td className="p-3 text-gray-600">{e.country}</td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${e.ownership}%`, background: e.color }} />
                            </div>
                            <span>{e.ownership}%</span>
                          </div>
                        </td>
                        <td className="p-3 text-right text-green-600">{ic.receivable === null ? '—' : ic.receivable > 0 ? fmt(ic.receivable, 'TRY') : '-'}</td>
                        <td className="p-3 text-right text-red-500">{ic.payable === null ? '—' : ic.payable > 0 ? fmt(ic.payable, 'TRY') : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* CHART OF ACCOUNTS VIEW */}
      {view === 'coa' && (
        <div className="space-y-4">
          {/* Entity selector */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setSelectedEntityId(null)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${!selectedEntityId ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {tr ? 'Tümü' : 'All'}
            </button>
            {entities.map(e => (
              <button key={e.id} onClick={() => setSelectedEntityId(e.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${selectedEntityId === e.id ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                style={selectedEntityId === e.id ? { background: e.color } : {}}
              >
                {e.name}
              </button>
            ))}
          </div>

          <div className="apple-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Kod' : 'Code'}</th>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Hesap Adı' : 'Account Name'}</th>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Tür' : 'Type'}</th>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Şirket' : 'Entity'}</th>
                  <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Bakiye' : 'Balance'}</th>
                </tr>
              </thead>
              <tbody>
                {accounts
                  .filter(a => !selectedEntityId || a.entityId === selectedEntityId)
                  .sort((a,b) => a.code.localeCompare(b.code))
                  .map(a => {
                    const entity = entityMap[a.entityId];
                    const typeInfo = ACCOUNT_TYPES.find(t => t.value === a.type);
                    return (
                      <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="p-3 font-mono text-gray-700">{a.code}</td>
                        <td className="p-3">{a.name}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            a.type === 'asset' ? 'bg-blue-50 text-blue-700' :
                            a.type === 'liability' ? 'bg-red-50 text-red-700' :
                            a.type === 'equity' ? 'bg-purple-50 text-purple-700' :
                            a.type === 'revenue' ? 'bg-green-50 text-green-700' :
                            'bg-orange-50 text-orange-700'}`}>
                            {typeInfo?.label.split(' / ')[tr ? 0 : 1] || a.type}
                          </span>
                        </td>
                        <td className="p-3">
                          {entity && <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: entity.color }} />
                            <span className="text-gray-600">{entity.name}</span>
                          </div>}
                        </td>
                        <td className={`p-3 text-right font-medium ${a.balance >= 0 ? 'text-gray-900' : 'text-red-500'}`}>
                          {fmt(a.balance, a.currency)}
                        </td>
                      </tr>
                    );
                  })}
                {accounts.filter(a => !selectedEntityId || a.entityId === selectedEntityId).length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">{tr ? 'Hesap bulunamadı.' : 'No accounts found.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* INTERCOMPANY VIEW */}
      {view === 'intercompany' && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="apple-card p-4">
              <p className="text-sm text-gray-500">{tr ? 'Açık İşlemler' : 'Open Transactions'}</p>
              <p className="text-2xl font-bold mt-1">{intercompany.filter(ic=>!ic.eliminated).length}</p>
            </div>
            <div className="apple-card p-4">
              <p className="text-sm text-gray-500">{tr ? 'Elimine Edildi' : 'Eliminated'}</p>
              <p className="text-2xl font-bold mt-1 text-green-600">{intercompany.filter(ic=>ic.eliminated).length}</p>
            </div>
          </div>

          <div className="apple-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Tarih' : 'Date'}</th>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Gönderen' : 'From'}</th>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Alıcı' : 'To'}</th>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Tür' : 'Type'}</th>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Açıklama' : 'Description'}</th>
                  <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Tutar' : 'Amount'}</th>
                  <th className="text-center p-3 font-medium text-gray-600">{tr ? 'Durum' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {intercompany.sort((a,b) => b.date.localeCompare(a.date)).map(ic => {
                  const from = entityMap[ic.fromEntityId];
                  const to = entityMap[ic.toEntityId];
                  return (
                    <tr key={ic.id} className={`border-b border-gray-50 hover:bg-gray-50 ${ic.eliminated ? 'opacity-60' : ''}`}>
                      <td className="p-3 text-gray-600">{ic.date}</td>
                      <td className="p-3">
                        {from && <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background: from.color }} />
                          {from.name}
                        </div>}
                      </td>
                      <td className="p-3">
                        {to && <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background: to.color }} />
                          {to.name}
                        </div>}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 capitalize">{ic.type.replace('_',' ')}</span>
                      </td>
                      <td className="p-3 text-gray-600">{ic.description}</td>
                      <td className="p-3 text-right font-medium">{fmt(ic.amount, ic.currency)}</td>
                      <td className="p-3 text-center">
                        <button onClick={() => toggleEliminate(ic)}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium transition-all ${ic.eliminated ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'}`}>
                          {ic.eliminated ? (tr ? 'Elimine Edildi' : 'Eliminated') : (tr ? 'Açık' : 'Open')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {intercompany.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-gray-400">{tr ? 'Şirketlerarası işlem bulunamadı.' : 'No intercompany transactions.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CONSOLIDATION VIEW */}
      {view === 'consolidation' && (
        <div className="space-y-6">
          {/* Key metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: tr ? 'Toplam Varlık' : 'Total Assets', value: totalAssets, icon: TrendingUp, color: 'text-blue-600' },
              { label: tr ? 'Net Gelir' : 'Net Income', value: netIncome, icon: netPozitif === false ? TrendingDown : TrendingUp, color: netRenk },
              { label: tr ? 'Toplam Borç' : 'Total Liabilities', value: totalLiabilities, icon: Minus, color: 'text-red-500' },
              { label: tr ? 'Özkaynak' : 'Equity', value: topla(totalEquity, netIncome), icon: Building2, color: 'text-purple-600' },
            ].map((m, i) => (
              <div key={i} className="apple-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <m.icon className={`w-4 h-4 ${m.color}`} />
                </div>
                <p className={`text-xl font-bold ${m.color}`}>{fmt(m.value)}</p>
              </div>
            ))}
          </div>

          {/* Bilanço eşitliği kontrolü: Varlık = Borç + Özkaynak (net gelir dahil) */}
          {(() => {
            // Bilesenlerden biri kur eksikligi yuzunden hesaplanamiyorsa "dengeli/dengesiz"
            // hukmu de verilemez — TL uzerinden hesaplayip ₺ basmak yaniltici olurdu.
            if (totalAssets === null || totalLiabilities === null || totalEquity === null || netIncome === null) {
              return (
                <div className="apple-card p-3 flex items-center gap-2 text-sm text-gray-500">
                  {tr
                    ? 'Denge kontrolü yapılamıyor — bazı hesapların para birimi için kur verisi yok.'
                    : 'Balance check unavailable — exchange rate data missing for some accounts.'}
                </div>
              );
            }
            const fark = totalAssets - (totalLiabilities + totalEquity + netIncome);
            const dengeli = Math.abs(fark) < 1;
            return (
              <div className={`apple-card p-3 flex items-center gap-2 text-sm ${dengeli ? 'text-green-600' : 'text-amber-700 bg-amber-50'}`}>
                {dengeli
                  ? (tr ? '✓ Bilanço dengeli (Varlık = Borç + Özkaynak)' : '✓ Balance sheet balanced')
                  : (tr ? `⚠️ Denge farkı: ${fmt(fark)} — Varlık ≠ Borç + Özkaynak (hesap/işaret kontrolü gerekli)` : `⚠️ Imbalance: ${fmt(fark)}`)}
              </div>
            );
          })()}

          {/* P&L */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="apple-card p-4 space-y-3">
              <h3 className="font-semibold text-sm">{tr ? 'Konsolide Gelir Tablosu' : 'Consolidated P&L'}</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{tr ? 'Toplam Gelir' : 'Total Revenue'}</span>
                  <span className="font-medium text-green-600">{fmt(totalRevenue)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{tr ? 'Toplam Gider' : 'Total Expenses'}</span>
                  <span className="font-medium text-red-500">({fmt(totalExpense)})</span>
                </div>
                <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-semibold">
                  <span>{tr ? 'Net Kar/Zarar' : 'Net Income/Loss'}</span>
                  <span className={netRenk}>{fmt(netIncome)}</span>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <span>{tr ? 'Kar Marjı' : 'Net Margin'}</span>
                  <span className="font-medium">{(totalRevenue === null || netIncome === null) ? '—' : `${totalRevenue > 0 ? ((netIncome/totalRevenue)*100).toFixed(1) : 0}%`}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${netPozitif === false ? 'bg-red-500' : 'bg-green-500'}`}
                    style={{ width: `${(totalRevenue === null || netIncome === null) ? 0 : Math.min(Math.abs(totalRevenue > 0 ? (netIncome/totalRevenue)*100 : 0), 100)}%` }} />
                </div>
              </div>
            </div>

            {/* Balance sheet */}
            <div className="apple-card p-4 space-y-3">
              <h3 className="font-semibold text-sm">{tr ? 'Konsolide Bilanço' : 'Consolidated Balance Sheet'}</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{tr ? 'Varlıklar' : 'Assets'}</span>
                  <span className="font-medium text-blue-600">{fmt(totalAssets)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{tr ? 'Yükümlülükler' : 'Liabilities'}</span>
                  <span className="font-medium text-red-500">{fmt(totalLiabilities)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{tr ? 'Özkaynak' : 'Equity'}</span>
                  <span className="font-medium text-purple-600">{fmt(totalEquity)}</span>
                </div>
                <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-semibold">
                  <span>{tr ? 'Dönem Net Karı' : 'Period Net Income'}</span>
                  <span className={netRenk}>{fmt(netIncome)}</span>
                </div>
              </div>
              {/* Debt ratio */}
              {totalAssets !== null && totalLiabilities !== null && totalAssets > 0 && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <span>{tr ? 'Borç Oranı' : 'Debt Ratio'}</span>
                    <span className="font-medium">{((totalLiabilities/totalAssets)*100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full"
                      style={{ width: `${Math.min((totalLiabilities/totalAssets)*100, 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Entity breakdown */}
          {entities.length > 0 && (
            <div className="apple-card p-4">
              <h3 className="font-semibold text-sm mb-3">{tr ? 'Şirket Bazlı Özet' : 'Per-Entity Summary'}</h3>
              <div className="space-y-2">
                {entities.map(e => {
                  const entityAccs = accounts.filter(a => a.entityId === e.id);
                  const eRevenue = entityAccs.filter(a=>a.type==='revenue').reduce((s,a)=>s+a.balance,0);
                  const eExpense = entityAccs.filter(a=>a.type==='expense').reduce((s,a)=>s+a.balance,0);
                  const eNet = eRevenue - eExpense;
                  return (
                    <div key={e.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: e.color }} />
                      <span className="text-sm font-medium flex-1">{e.name}</span>
                      <span className="text-sm text-gray-500">{e.ownership}%</span>
                      <span className="text-sm font-medium w-32 text-right">{tr ? 'Gelir: ' : 'Rev: '}{fmt(eRevenue, e.currency)}</span>
                      <span className={`text-sm font-semibold w-28 text-right ${eNet >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmt(eNet, e.currency)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ENTITY FORM MODAL */}
      {showEntityForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tr ? 'Yeni Şirket' : 'New Entity'}</h2>
              <button onClick={() => setShowEntityForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <input className="apple-input w-full p-3 rounded-xl text-sm" placeholder={tr ? 'Şirket Adı *' : 'Entity Name *'} value={eForm.name} onChange={e=>setEForm(p=>({...p,name:e.target.value}))} />
              <input className="apple-input w-full p-3 rounded-xl text-sm" placeholder={tr ? 'Vergi No' : 'Tax ID'} value={eForm.taxId} onChange={e=>setEForm(p=>({...p,taxId:e.target.value}))} />
              <div className="grid grid-cols-2 gap-3">
                <input className="apple-input w-full p-3 rounded-xl text-sm" placeholder={tr ? 'Ülke' : 'Country'} value={eForm.country} onChange={e=>setEForm(p=>({...p,country:e.target.value}))} />
                <select className="apple-input w-full p-3 rounded-xl text-sm" value={eForm.currency} onChange={e=>setEForm(p=>({...p,currency:e.target.value}))}>
                  <option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Tür' : 'Type'}</label>
                  <select className="apple-input w-full p-3 rounded-xl text-sm" value={eForm.entityType} onChange={e=>setEForm(p=>({...p,entityType:e.target.value as Entity['entityType']}))}>
                    <option value="subsidiary">Subsidiary</option>
                    <option value="affiliate">Affiliate</option>
                    <option value="branch">Branch</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Sahiplik %' : 'Ownership %'}</label>
                  <input type="number" min="1" max="100" className="apple-input w-full p-3 rounded-xl text-sm" value={eForm.ownership} onChange={e=>setEForm(p=>({...p,ownership:Number(e.target.value)}))} />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowEntityForm(false)} className="apple-button-secondary flex-1 p-3 rounded-full text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={addEntity} className="apple-button-primary text-white flex-1 p-3 rounded-full text-sm">{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ACCOUNT FORM MODAL */}
      {showAccountForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tr ? 'Yeni Hesap' : 'New Account'}</h2>
              <button onClick={() => setShowAccountForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <select className="apple-input w-full p-3 rounded-xl text-sm" value={aForm.entityId} onChange={e=>setAForm(p=>({...p,entityId:e.target.value}))}>
                <option value="">{tr ? 'Şirket Seçin *' : 'Select Entity *'}</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input className="apple-input p-3 rounded-xl text-sm font-mono" placeholder={tr ? 'Kod *' : 'Code *'} value={aForm.code} onChange={e=>setAForm(p=>({...p,code:e.target.value}))} />
                <select className="apple-input p-3 rounded-xl text-sm" value={aForm.type} onChange={e=>setAForm(p=>({...p,type:e.target.value as GLAccount['type']}))}>
                  {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <input className="apple-input w-full p-3 rounded-xl text-sm" placeholder={tr ? 'Hesap Adı *' : 'Account Name *'} value={aForm.name} onChange={e=>setAForm(p=>({...p,name:e.target.value}))} />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" className="apple-input p-3 rounded-xl text-sm" placeholder={tr ? 'Bakiye' : 'Balance'} value={aForm.balance} onChange={e=>setAForm(p=>({...p,balance:Number(e.target.value)}))} />
                <select className="apple-input p-3 rounded-xl text-sm" value={aForm.currency} onChange={e=>setAForm(p=>({...p,currency:e.target.value}))}>
                  <option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowAccountForm(false)} className="apple-button-secondary flex-1 p-3 rounded-full text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={addAccount} className="apple-button-primary text-white flex-1 p-3 rounded-full text-sm">{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* INTERCOMPANY FORM MODAL */}
      {showICForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tr ? 'Şirketlerarası İşlem' : 'Intercompany Transaction'}</h2>
              <button onClick={() => setShowICForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <select className="apple-input w-full p-3 rounded-xl text-sm" value={icForm.fromEntityId} onChange={e=>setICForm(p=>({...p,fromEntityId:e.target.value}))}>
                <option value="">{tr ? 'Gönderen Şirket *' : 'From Entity *'}</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <select className="apple-input w-full p-3 rounded-xl text-sm" value={icForm.toEntityId} onChange={e=>setICForm(p=>({...p,toEntityId:e.target.value}))}>
                <option value="">{tr ? 'Alıcı Şirket *' : 'To Entity *'}</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <select className="apple-input w-full p-3 rounded-xl text-sm" value={icForm.type} onChange={e=>setICForm(p=>({...p,type:e.target.value as Intercompany['type']}))}>
                <option value="trade">Trade</option>
                <option value="loan">Loan</option>
                <option value="dividend">Dividend</option>
                <option value="management_fee">Management Fee</option>
              </select>
              <input className="apple-input w-full p-3 rounded-xl text-sm" placeholder={tr ? 'Açıklama' : 'Description'} value={icForm.description} onChange={e=>setICForm(p=>({...p,description:e.target.value}))} />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" className="apple-input p-3 rounded-xl text-sm" placeholder={tr ? 'Tutar *' : 'Amount *'} value={icForm.amount || ''} onChange={e=>setICForm(p=>({...p,amount:Number(e.target.value)}))} />
                <select className="apple-input p-3 rounded-xl text-sm" value={icForm.currency} onChange={e=>setICForm(p=>({...p,currency:e.target.value}))}>
                  <option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </div>
              <input type="date" className="apple-input w-full p-3 rounded-xl text-sm" value={icForm.date} onChange={e=>setICForm(p=>({...p,date:e.target.value}))} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowICForm(false)} className="apple-button-secondary flex-1 p-3 rounded-full text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={addIC} className="apple-button-primary text-white flex-1 p-3 rounded-full text-sm">{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
