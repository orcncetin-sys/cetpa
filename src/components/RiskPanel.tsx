import React, { useState, useEffect, useMemo } from 'react';
import { zamanMs, sonGuncellemeMs } from '../utils/zaman';
import { bilinenSayi } from '../utils/para';
import { riskSatirlari, riskToplamlari, riskSiralaKarsilastir, bakiyesiBilinir } from '../utils/muhasebe/riskSatirlari';
import BakiyeDamgasi from './ortak/BakiyeDamgasi';
import { motion } from 'motion/react';
import { AlertTriangle, TrendingUp, ShieldCheck, DollarSign, Users } from 'lucide-react';
import { collection, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { logFirestoreError, OperationType } from '../utils/firebase';
import { tlYaz } from '../utils/currency';
import { oc } from '../i18n/ortak';

interface CustomerRisk {
  id: string;
  customerName: string;
  /** Bilinmiyorsa NaN (`bakiyeBilinmiyor`). */
  currentBalance: number;
  creditLimit: number;
  /** Bakiye bilinmiyorsa null. */
  riskScore: number | null;
  /** Mikro bakiye kaydı yok ya da sayı değil (şartname «Mikro bağlantı A» A4): listede kalır, toplamlara girmez. */
  bakiyeBilinmiyor?: boolean;
  [key: string]: unknown;
}

type ExchangeRates = Record<string, number>;

interface RiskPanelProps {
  // Zaman damgalari `unknown`: gercek bicimler bu dar tipten GENIS (Timestamp
  // ornegi, revive edilmemis {_seconds} zarfi, epoch sayi). Dar tip
  // `new Date(x)` gibi yanlis kullanimlari mesrulastiriyordu; cozumleme
  // src/utils/zaman.ts'in isi. createdAt eklendi: pazaryeri siparislerinde
  // syncedAt YOK (2026-08-24 tarih denetimi).
  orders: { id: string, customerName: string, status: string, totalPrice: number, dueDate?: unknown, syncedAt?: unknown, createdAt?: unknown, shopifyOrderId?: string, leadId?: string }[];
  leads: { id: string, name: string, company?: string, paymentTerms?: string }[];
  currentLanguage: 'tr' | 'en';
  userRole: string | null;
  setActiveTab?: (tab: string) => void;
  exchangeRates?: ExchangeRates | null;
}

type Currency = 'TRY' | 'USD' | 'EUR';

// ─── Currency helpers ─────────────────────────────────────────────────────────
// Tek kaynak (Faz 2 1/n): tlYaz kur yoksa '—' basar — eski convertAmount kur yokken
// TL tutarını '$' sembolüyle geri veriyordu (sahte kur). İmza korundu.
function formatAmount(tryAmount: number, currency: Currency, rates?: ExchangeRates | null): string {
  return tlYaz(tryAmount, { birim: currency, rates, ondalik: 0 });
}

// ─── Currency Toggle ──────────────────────────────────────────────────────────
function CurrencyToggle({ active, onChange }: { active: Currency; onChange: (c: Currency) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
      {(['TRY', 'USD', 'EUR'] as Currency[]).map(c => (
        <button
          key={c}
          onClick={e => { e.stopPropagation(); onChange(c); }}
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-all ${active === c ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
        >
          {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
        </button>
      ))}
    </div>
  );
}

// ─── SortTh ──────────────────────────────────────────────────────────────────
function SortTh({ k, label, sort, onSort, align = 'left' }: {
  k: string; label: string;
  sort: { key: string; dir: 'asc' | 'desc' };
  onSort: (k: string) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onSort(k)}
      className={`cursor-pointer select-none py-3 px-4 text-${align} text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${active ? 'text-brand' : 'text-gray-400 hover:text-gray-600'}`}
    >
      {label}{' '}
      <span className={active ? 'opacity-100' : 'opacity-25'}>{active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </th>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
const RiskPanel: React.FC<RiskPanelProps> = ({ orders = [], leads = [], currentLanguage, userRole, setActiveTab, exchangeRates }) => {
  const [risks, setRisks] = useState<CustomerRisk[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'highRisk' | 'exposure' | 'overdue'>('all');
  const [activeCurrency, setActiveCurrency] = useState<Currency>('TRY');
  const [riskSort, setRiskSort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'riskScore', dir: 'desc'});
  const [overdueSort, setOverdueSort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'customerName', dir: 'asc'});

  useEffect(() => {
    if (!userRole) return;
    const unsubscribe = onSnapshot(collection(db, 'customerRisks'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomerRisk));
      setRisks(data);
    }, (error) => logFirestoreError(error, OperationType.LIST, 'customerRisks'));
    return () => unsubscribe();
  }, [userRole]);

  // ── Mikro cari bakiyeleri (gerçek risk kaynağı) ─────────────────────────────
  // customerRisks (Cetpa) hiç dolmuyor → panel hep ₺0 görünüyordu. Gerçek bakiye
  // cariBalances'ta (Mikro, /api/mikro/pull/bakiye doldurur; doc id = cariKod,
  // {cariKod, bakiye}). İsim/limit için leads (mikroCariKod ile eşleşir).
  // Değer: bilinen sayı ya da null (belge var, bakiye sayı değil); belge yoksa harita dışı (A4: ikisi de «bilinmiyor»).
  const [cariBalances, setCariBalances] = useState<Map<string, number | null>>(new Map());
  /** «son bakiye çekimi» damgası (A3.4): belgelerin en büyük `updatedAt`'i; belge yoksa null (damga basılmaz). */
  const [bakiyeSonMs, setBakiyeSonMs] = useState<number | null>(null);
  const [mikroLeads, setMikroLeads] = useState<Array<{ cariKod: string; name: string; creditLimit: number }>>([]);

  useEffect(() => {
    if (!userRole) return;
    const unsub = onSnapshot(collection(db, 'cariBalances'), (snapshot) => {
      const m = new Map<string, number | null>();
      const zamanlar: unknown[] = [];
      snapshot.docs.forEach(d => {
        const x = d.data() as Record<string, unknown>;
        const kod = String(x.cariKod ?? d.id).trim();
        // Eski `Number(x.bakiye ?? 0)` sayı olmayan bakiyeyi ₺0 yapıyordu (A4).
        if (kod) m.set(kod, bilinenSayi(x.bakiye) ? Number(x.bakiye) : null);
        zamanlar.push(x.updatedAt);
      });
      setCariBalances(m);
      setBakiyeSonMs(sonGuncellemeMs(zamanlar));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'cariBalances'));
    return () => unsub();
  }, [userRole]);

  useEffect(() => {
    if (!userRole) return;
    const unsub = onSnapshot(collection(db, 'leads'), (snapshot) => {
      setMikroLeads(snapshot.docs.map(d => {
        const x = d.data() as Record<string, unknown>;
        return {
          cariKod: String(x.mikroCariKod ?? '').trim(),
          name: String(x.company ?? x.name ?? '—'),
          creditLimit: Number(x.creditLimit ?? 0),
        };
      }).filter(l => l.cariKod));
    }, (error) => logFirestoreError(error, OperationType.LIST, 'leads'));
    return () => unsub();
  }, [userRole]);

  // Etkin risk listesi. customerRisks (Cetpa) BAYAT — isim var ama bakiye hep 0
  // (ekranda görünen sorun buydu). Bu yüzden Mikro bakiyesi (cariBalances) VARSA
  // gerçek kaynak odur; customerRisks yalnız Mikro hiç çekilmemişse geriye-uyum.
  // Bakiye>0 = müşteri Cetpa'ya borçlu (exposure). Skor = kredi limiti kullanım
  // oranı; limit yoksa 0 (hesaplanamaz — uydurmuyoruz, bakiye yine listelenir).
  // Satırlar + toplamlar TEK kaynakta (utils/muhasebe/riskSatirlari, A4): bakiye kaydı olmayan ya da sayı olmayan cari ₺0 sayılıp
  // DÜŞÜRÜLMEZ; listede «Bakiye bilinmiyor» olarak kalır, toplamlara girmez, sayılır.
  const effectiveRisks = useMemo<CustomerRisk[]>(() => {
    if (cariBalances.size && mikroLeads.length) return riskSatirlari(mikroLeads, cariBalances);
    return risks;
  }, [risks, cariBalances, mikroLeads]);

  // Exposure = yalnız POZİTİF bilinen bakiyeler (müşteri borcu). Eksi = Cetpa borçlu, risk değil.
  const kpis = useMemo(() => riskToplamlari(effectiveRisks), [effectiveRisks]);

  const chartData = useMemo(() => {
    const tr = currentLanguage === 'tr';
    const categories: Record<string, number> = {
      [oc(tr).dusuk]: 0,
      [tr ? 'Orta' : 'Mid']: 0,
      [oc(tr).yuksek]: 0
    };
    effectiveRisks.filter(bakiyesiBilinir).forEach(r => {
      const score = Number(r.riskScore);
      if (score < 40) categories[oc(tr).dusuk]++;
      else if (score < 70) categories[tr ? 'Orta' : 'Mid']++;
      else categories[oc(tr).yuksek]++;
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [effectiveRisks, currentLanguage]);

  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  const overdueOrders = useMemo(() => {
    const now = new Date();
    return orders.filter(o => {
      if (o.status === 'Delivered' || o.status === 'Cancelled') return false;
      const lead = leads.find(l => l.id === o.leadId || l.name === o.customerName);
      let daysAllowed = 30;
      if (lead?.paymentTerms) {
        const match = lead.paymentTerms.match(/\d+/);
        if (match) daysAllowed = parseInt(match[0], 10);
      }
      // Bkz. App.tsx'teki ayni hesap: tarih cozulemezse
      // siparis GECIKMIS SAYILMAZ. `|| now` yedegi, syncedAt'i olmayan
      // pazaryeri siparislerini "bugun verilmis" yapip vadesini hep gelecege
      // atiyordu; hicbiri gecikmis listesine girmiyordu (2026-08-24).
      // `createdAt`/`syncedAt` types.ts'te `unknown`; zamanMs'in kabul ettigi
      // birlesim disa aktarilmadigi icin imzadan turetilir (bkz. App.tsx:2890).
      // Tanimadigi bir deger gelirse zamanMs yine null doner - "simdi"ye dusmez.
      type ZamanArg = Parameters<typeof zamanMs>[0];
      const siparisMs = zamanMs(o.createdAt as ZamanArg) ?? zamanMs(o.syncedAt as ZamanArg);
      if (siparisMs === null) return false;
      const dueDate = new Date(siparisMs);
      dueDate.setDate(dueDate.getDate() + daysAllowed);
      return now > dueDate;
    });
  }, [orders, leads]);

  const filteredRisks = useMemo(() => {
    let base = effectiveRisks;
    if (activeFilter === 'highRisk') base = effectiveRisks.filter(r => bakiyesiBilinir(r) && Number(r.riskScore) > 70);
    else if (activeFilter === 'exposure') base = effectiveRisks.filter(r => bakiyesiBilinir(r) && Number(r.currentBalance) > 0);
    // Sütun tipine göre karşılaştır (customerName metin, diğerleri sayı); bakiyesi bilinmeyen satırlar iki yönde de SONDA (A4).
    return [...base].sort(riskSiralaKarsilastir(riskSort.key, riskSort.dir));
  }, [effectiveRisks, activeFilter, riskSort]);

  const sortedOverdue = useMemo(() => [...overdueOrders].sort((a, b) => {
    const av = (a as Record<string, unknown>)[overdueSort.key] as string | number ?? '';
    const bv = (b as Record<string, unknown>)[overdueSort.key] as string | number ?? '';
    if (av < bv) return overdueSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return overdueSort.dir === 'asc' ? 1 : -1;
    return 0;
  }), [overdueOrders, overdueSort]);

  const totalPages = Math.ceil(sortedOverdue.length / ordersPerPage);
  const currentOverdueOrders = sortedOverdue.slice((currentPage - 1) * ordersPerPage, currentPage * ordersPerPage);

  const tr = currentLanguage === 'tr';

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

      {/* Currency rate context bar */}
      {exchangeRates && (
        <div className="flex items-center gap-3 text-[10px] text-gray-500 bg-white/70 backdrop-blur rounded-xl px-4 py-2 border border-gray-100 w-fit">
          <span className="font-semibold text-gray-600">{tr ? 'Canlı Kur:' : 'Live Rate:'}</span>
          <span>$ <b className="text-gray-800">₺{exchangeRates.USD.toFixed(2)}</b></span>
          <span>€ <b className="text-gray-800">₺{exchangeRates.EUR.toFixed(2)}</b></span>
          {activeCurrency !== 'TRY' && (
            <span className="text-brand font-bold">
              {tr ? `Değerler ${activeCurrency} cinsinden gösteriliyor` : `Values shown in ${activeCurrency}`}
            </span>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1 — Toplam Riskli Bakiye (with currency toggle) */}
        <button
          onClick={() => setActiveFilter('exposure')}
          className={`apple-card p-5 text-left flex flex-col gap-3 ${activeFilter === 'exposure' ? 'ring-2 ring-brand/20' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <CurrencyToggle active={activeCurrency} onChange={setActiveCurrency} />
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{tr ? 'Toplam Riskli Bakiye' : 'Total Exposure'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatAmount(kpis.totalExposure, activeCurrency, exchangeRates)}</p>
            {kpis.bilinmeyen > 0 && (
              <p data-risk-bilinmeyen className="text-[10px] text-amber-600 mt-1">
                {tr ? `${kpis.bilinmeyen} carinin bakiyesi bilinmiyor` : `${kpis.bilinmeyen} accounts with unknown balance`}
              </p>
            )}
            <BakiyeDamgasi sonMs={bakiyeSonMs} dil={tr ? 'tr' : 'en'} className="mt-1" />
          </div>
        </button>

        {/* Card 2 — Yüksek Riskli Müşteri */}
        <button
          onClick={() => setActiveFilter('highRisk')}
          className={`apple-card p-5 text-left flex flex-col gap-3 ${activeFilter === 'highRisk' ? 'ring-2 ring-red-200' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{tr ? 'Yüksek Riskli Müşteri' : 'High Risk Customers'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{kpis.highRiskCount}</p>
          </div>
        </button>

        {/* Card 3 — Geciken Siparişler */}
        <button
          onClick={() => { document.getElementById('overdue-section')?.scrollIntoView({ behavior: 'smooth' }); setActiveFilter('all'); }}
          className={`apple-card p-5 text-left flex flex-col gap-3 ${activeFilter === 'overdue' ? 'ring-2 ring-amber-200' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-amber-500" />
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{tr ? 'Geciken Siparişler' : 'Overdue Orders'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{overdueOrders.length}</p>
          </div>
        </button>

        {/* Card 4 — Ortalama Risk Skoru */}
        <button
          onClick={() => setActiveFilter('all')}
          className={`apple-card p-5 text-left flex flex-col gap-3 ${activeFilter === 'all' ? 'ring-2 ring-green-200' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-green-500" />
            </div>
          </div>
          <div>
            <p className="text-[11px] text-[#86868B] font-medium uppercase tracking-wide">{tr ? 'Ortalama Risk Skoru' : 'Avg Risk Score'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{kpis.avgRiskScore}</p>
          </div>
        </button>
      </div>

      {/* Main Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution Chart */}
        <div className="lg:col-span-1 apple-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-gray-800">{tr ? 'Risk Dağılımı' : 'Risk Distribution'}</h3>
            {activeFilter !== 'all' && (
              <button onClick={() => setActiveFilter('all')} className="text-xs text-brand font-bold hover:underline">
                {oc(tr).temizle}
              </button>
            )}
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.name === (oc(tr).yuksek) ? '#ef4444' :
                        entry.name === (tr ? 'Orta' : 'Mid') ? '#f59e0b' : '#10b981'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Table */}
        <div className="lg:col-span-2 apple-card overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800">
              {tr ? 'Müşteri Bazlı Detaylar' : 'Customer Details'}
              {activeFilter !== 'all' && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  ({filteredRisks.length} {oc(tr).kayit})
                </span>
              )}
            </h3>
            <button onClick={() => setActiveTab?.('muhasebe')} className="apple-button-secondary py-1.5 px-3 text-xs">
              <DollarSign size={12} />
              {tr ? 'Bakiye Raporu' : 'Balance Report'}
            </button>
          </div>
          <div className="overflow-x-auto">
            {/* 480: lg:col-span-2 kolonu 1024px viewport'ta ~490px — 560
                masaüstünde gereksiz yatay scroll üretip İşlem kolonunu
                gizliyordu (macOS overlay scrollbar görünmez; code-review). */}
            <table className="min-w-[480px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <SortTh k="customerName" label={oc(tr).musteri} sort={riskSort} onSort={k => setRiskSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} />
                  <SortTh k="currentBalance" label={`${oc(tr).bakiye} (${activeCurrency})`} sort={riskSort} onSort={k => setRiskSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} align="right" />
                  <SortTh k="creditLimit" label={`${tr?'Limit':'Limit'} (${activeCurrency})`} sort={riskSort} onSort={k => setRiskSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} align="right" />
                  <SortTh k="riskScore" label={oc(tr).skor} sort={riskSort} onSort={k => setRiskSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} align="center" />
                  <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{oc(tr).islem}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRisks.length > 0 ? filteredRisks.map((c) => {
                  // Bakiye bilinmiyorsa tutar ve skor BASILMAZ (eski `Number(c.currentBalance || 0)` ₺0 basıyordu; A4).
                  const bilinir = bakiyesiBilinir(c);
                  const creditLimit = Number(c.creditLimit || 0);
                  const riskScore = Number(c.riskScore);
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium">{String(c.customerName || '')}</td>
                      <td className="px-6 py-4 text-right font-mono text-sm">
                        {bilinir
                          ? formatAmount(Number(c.currentBalance), activeCurrency, exchangeRates)
                          : <span data-bakiye-bilinmiyor className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500 font-sans">{tr ? 'Bakiye bilinmiyor' : 'Balance unknown'}</span>}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm">{formatAmount(creditLimit, activeCurrency, exchangeRates)}</td>
                      <td className="px-6 py-4 text-center">
                        {bilinir && Number.isFinite(riskScore) ? (
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${riskScore > 70 ? 'bg-red-100 text-red-600' : riskScore > 40 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
                            {riskScore}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button onClick={() => setActiveTab?.('muhasebe')} className="action-btn-view" title={tr ? 'Muhasebe Detayı' : 'Accounting Detail'}>
                          <Users size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400 text-sm">
                      {oc(tr).kayit_bulunamadi}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Overdue Orders */}
      <div id="overdue-section" className="apple-card overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-gray-800">{tr ? 'Ödemesi Geciken Siparişler' : 'Overdue Orders'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{tr ? 'Vade tarihi geçmiş ve henüz ödenmemiş' : 'Past due date, unpaid'}</p>
          </div>
          <div className="flex items-center gap-2">
            <CurrencyToggle active={activeCurrency} onChange={setActiveCurrency} />
            <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-bold">
              {overdueOrders.length} {oc(tr).siparis_2}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[560px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <SortTh k="shopifyOrderId" label={oc(tr).siparis_id} sort={overdueSort} onSort={k => setOverdueSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} />
                <SortTh k="customerName" label={oc(tr).musteri} sort={overdueSort} onSort={k => setOverdueSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} />
                <SortTh k="totalPrice" label={`${oc(tr).tutar} (${activeCurrency})`} sort={overdueSort} onSort={k => setOverdueSort(s => ({key:k, dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} align="right" />
                <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider">{oc(tr).durum}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {currentOverdueOrders.length > 0 ? currentOverdueOrders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{order.shopifyOrderId || order.id}</td>
                  <td className="px-6 py-4 text-gray-600">{order.customerName}</td>
                  <td className="px-6 py-4 text-right font-mono">{formatAmount(order.totalPrice, activeCurrency, exchangeRates)}</td>
                  <td className="px-6 py-4 text-center">
                    <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-50 text-red-600 border border-red-100">
                      {oc(tr).gecikmis_2}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-400 text-sm">
                    {tr ? 'Geciken sipariş bulunmamaktadır.' : 'No overdue orders found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <p className="text-sm text-gray-500">
              {oc(tr).toplam} <span className="font-medium">{sortedOverdue.length}</span> {tr ? 'kayıttan' : 'records,'}{' '}
              <span className="font-medium">{(currentPage - 1) * ordersPerPage + 1}–{Math.min(currentPage * ordersPerPage, overdueOrders.length)}</span> {tr ? 'gösteriliyor' : 'showing'}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                {tr ? 'Önceki' : 'Previous'}
              </button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                {tr ? 'Sonraki' : 'Next'}
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default RiskPanel;
