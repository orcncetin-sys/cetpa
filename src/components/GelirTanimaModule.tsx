import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';
import { TrendingUp, Plus, X, ChevronRight, ChevronDown, CheckCircle2, Clock, BarChart3, Calendar, FileText, DollarSign } from 'lucide-react';

interface GelirTanimaModuleProps {
  currentLanguage: string;
  isAuthenticated: boolean;
}

// IFRS 15 / BÖBİ — 5-step Revenue Recognition model
interface Contract {
  id: string;
  contractNo: string;
  customerName: string;
  contractDate: string;
  startDate: string;
  endDate: string;
  totalValue: number;
  currency: string;
  method: 'poc' | 'milestone' | 'straight_line' | 'output';
  status: 'active' | 'completed' | 'cancelled' | 'on_hold';
  notes: string;
  obligations: PerformanceObligation[];
  createdAt: any;
}

interface PerformanceObligation {
  id: string;
  description: string;
  standalonePrice: number;
  allocationPercent: number;
  allocatedValue: number;
  recognitionMethod: 'poc' | 'milestone' | 'straight_line' | 'output';
  estimatedCompletionDate: string;
  status: 'not_started' | 'in_progress' | 'completed';
}

interface RevenueSchedule {
  id: string;
  contractId: string;
  contractNo: string;
  customerName: string;
  obligationId: string;
  obligationDesc: string;
  period: string; // YYYY-MM
  scheduledAmount: number;
  recognizedAmount: number;
  deferredAmount: number;
  recognitionDate?: string;
  method: string;
  journalEntry?: string;
  status: 'scheduled' | 'recognized' | 'deferred' | 'reversed';
  createdAt: any;
}

function fmt(n: number, currency = 'TRY') {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n);
}


function straightLineMonths(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
}

export default function GelirTanimaModule({ currentLanguage, isAuthenticated }: GelirTanimaModuleProps) {
  const tr = currentLanguage === 'tr';
  const [view, setView] = useState<'contracts' | 'schedule' | 'deferred' | 'recognition'>('contracts');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [schedules, setSchedules] = useState<RevenueSchedule[]>([]);
  const [showContractForm, setShowContractForm] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState<Contract | null>(null);
  const [expandedContractId, setExpandedContractId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Contract form
  const blankContract = () => ({ contractNo: '', customerName: '', contractDate: new Date().toISOString().split('T')[0], startDate: '', endDate: '', totalValue: 0, currency: 'TRY', method: 'straight_line' as Contract['method'], notes: '', obligations: [] as PerformanceObligation[] });
  const [cForm, setCForm] = useState(blankContract());
  const [oblForms, setOblForms] = useState<Omit<PerformanceObligation,'id'>[]>([]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(collection(db, 'revenueContracts'), snap => {
      setContracts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contract)));
      setLoading(false);
    }));
    unsubs.push(onSnapshot(collection(db, 'revenueSchedules'), snap => {
      setSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() } as RevenueSchedule)));
    }));
    return () => unsubs.forEach(u => u());
  }, []);

  const addObligation = () => {
    setOblForms(prev => [...prev, {
      description: '',
      standalonePrice: 0,
      allocationPercent: 0,
      allocatedValue: 0,
      recognitionMethod: 'straight_line',
      estimatedCompletionDate: cForm.endDate,
      status: 'not_started',
    }]);
  };

  const saveContract = async () => {
    if (!cForm.contractNo.trim() || !cForm.customerName.trim()) return;
    // Auto-calculate allocation if not done
    const totalStandalone = oblForms.reduce((s, o) => s + o.standalonePrice, 0);
    const obligations: PerformanceObligation[] = oblForms.map((o, i) => ({
      id: `obl-${i}`,
      ...o,
      allocationPercent: totalStandalone > 0 ? (o.standalonePrice / totalStandalone) * 100 : 100 / oblForms.length,
      allocatedValue: totalStandalone > 0 ? (o.standalonePrice / totalStandalone) * cForm.totalValue : cForm.totalValue / oblForms.length,
    }));
    await addDoc(collection(db, 'revenueContracts'), {
      ...cForm,
      obligations,
      status: 'active',
      createdAt: serverTimestamp(),
    });
    setCForm(blankContract());
    setOblForms([]);
    setShowContractForm(false);
  };

  // Generate revenue schedule for a contract
  const generateSchedule = async (contract: Contract) => {
    const scheduleItems: Omit<RevenueSchedule, 'id' | 'createdAt'>[] = [];
    const start = new Date(contract.startDate);
    const end = new Date(contract.endDate);

    for (const obl of contract.obligations) {
      if (obl.recognitionMethod === 'straight_line') {
        const months = straightLineMonths(contract.startDate, contract.endDate);
        const monthlyAmount = obl.allocatedValue / months;
        const current = new Date(start);
        while (current <= end) {
          const period = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}`;
          scheduleItems.push({
            contractId: contract.id,
            contractNo: contract.contractNo,
            customerName: contract.customerName,
            obligationId: obl.id,
            obligationDesc: obl.description,
            period,
            scheduledAmount: monthlyAmount,
            recognizedAmount: 0,
            deferredAmount: monthlyAmount,
            method: 'straight_line',
            status: 'scheduled',
          });
          current.setMonth(current.getMonth() + 1);
        }
      } else if (obl.recognitionMethod === 'milestone') {
        // One schedule entry per milestone/period
        scheduleItems.push({
          contractId: contract.id,
          contractNo: contract.contractNo,
          customerName: contract.customerName,
          obligationId: obl.id,
          obligationDesc: obl.description,
          period: contract.startDate.slice(0,7),
          scheduledAmount: obl.allocatedValue,
          recognizedAmount: 0,
          deferredAmount: obl.allocatedValue,
          method: 'milestone',
          status: 'deferred',
        });
      }
    }

    // Save all schedule items
    for (const item of scheduleItems) {
      await addDoc(collection(db, 'revenueSchedules'), { ...item, createdAt: serverTimestamp() });
    }
    setShowScheduleModal(null);
  };

  const recognizeRevenue = async (schedule: RevenueSchedule) => {
    const now = new Date().toISOString();
    const journal = `DR Ertelenmiş Gelir ${fmt(schedule.scheduledAmount)} / CR Gelir ${fmt(schedule.scheduledAmount)}`;
    await updateDoc(doc(db, 'revenueSchedules', schedule.id), {
      status: 'recognized',
      recognizedAmount: schedule.scheduledAmount,
      deferredAmount: 0,
      recognitionDate: now,
      journalEntry: journal,
    });
  };

  // Analytics
  const totalContractValue = contracts.reduce((s,c) => s + c.totalValue, 0);
  const totalRecognized = schedules.reduce((s,r) => s + r.recognizedAmount, 0);
  const totalDeferred = schedules.reduce((s,r) => s + r.deferredAmount, 0);
  const totalScheduled = schedules.reduce((s,r) => s + r.scheduledAmount, 0);

  // Deferred revenue by month (next 12 months)
  const deferredByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      map[key] = 0;
    }
    schedules.filter(s => s.status !== 'recognized').forEach(s => {
      if (map[s.period] !== undefined) {
        map[s.period] = (map[s.period] || 0) + s.deferredAmount;
      }
    });
    return Object.entries(map).map(([period, amount]) => ({ period, amount }));
  }, [schedules]);

  const maxDeferred = Math.max(...deferredByMonth.map(m => m.amount), 1);

  const tabs = [
    { id: 'contracts', label: tr ? 'Sözleşmeler' : 'Contracts', icon: FileText },
    { id: 'schedule', label: tr ? 'Tanıma Takvimi' : 'Schedule', icon: Calendar },
    { id: 'deferred', label: tr ? 'Ertelenmiş Gelir' : 'Deferred Revenue', icon: Clock },
    { id: 'recognition', label: tr ? 'Analitik' : 'Analytics', icon: BarChart3 },
  ] as const;

  if (!isAuthenticated) return <div className="p-8 text-center text-gray-500">{tr ? 'Lütfen giriş yapın.' : 'Please sign in.'}</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{tr ? 'Gelir Tanıma' : 'Revenue Recognition'}</h1>
            <p className="text-sm text-gray-500">{tr ? 'IFRS 15 / BÖBİ — 5 adımlı model' : 'IFRS 15 / BÖBİ — 5-step model'}</p>
          </div>
        </div>
        {view === 'contracts' && (
          <button onClick={() => setShowContractForm(true)}
            className="apple-button-primary text-white px-4 py-2 rounded-full text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> {tr ? 'Sözleşme Ekle' : 'Add Contract'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-gray-100 rounded-2xl p-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-sm font-medium transition-all ${view === t.id ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: tr ? 'Toplam Sözleşme' : 'Total Contract Value', value: fmt(totalContractValue), icon: DollarSign, color: 'text-blue-600' },
          { label: tr ? 'Tanınan Gelir' : 'Recognized Revenue', value: fmt(totalRecognized), icon: CheckCircle2, color: 'text-green-600' },
          { label: tr ? 'Ertelenmiş Gelir' : 'Deferred Revenue', value: fmt(totalDeferred), icon: Clock, color: 'text-orange-600' },
          { label: tr ? 'Tanıma Oranı' : 'Recognition Rate', value: `${totalScheduled > 0 ? ((totalRecognized/totalScheduled)*100).toFixed(1) : 0}%`, icon: TrendingUp, color: 'text-purple-600' },
        ].map((m,i) => (
          <div key={i} className="apple-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">{m.label}</p>
              <m.icon className={`w-4 h-4 ${m.color}`} />
            </div>
            <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* CONTRACTS VIEW */}
      {view === 'contracts' && (
        <div className="space-y-3">
          {loading ? (
            <div className="p-8 text-center text-gray-400">{tr ? 'Yükleniyor...' : 'Loading...'}</div>
          ) : contracts.length === 0 ? (
            <div className="apple-card p-8 text-center text-gray-400">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>{tr ? 'Sözleşme bulunamadı.' : 'No contracts found.'}</p>
            </div>
          ) : (
            contracts.map(c => {
              const isExpanded = expandedContractId === c.id;
              const contractSchedules = schedules.filter(s => s.contractId === c.id);
              const contractRecognized = contractSchedules.reduce((s,r) => s + r.recognizedAmount, 0);
              const progress = c.totalValue > 0 ? (contractRecognized / c.totalValue) * 100 : 0;

              return (
                <div key={c.id} className="apple-card overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setExpandedContractId(isExpanded ? null : c.id)}>
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          </button>
                          <p className="font-semibold">{c.contractNo}</p>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'active' ? 'bg-green-100 text-green-700' : c.status === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                            {c.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-0.5 ml-6">{c.customerName}</p>
                        <p className="text-xs text-gray-400 ml-6">{c.startDate} → {c.endDate}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold">{fmt(c.totalValue, c.currency)}</p>
                        <p className="text-xs text-green-600">{tr ? 'Tanınan: ' : 'Recognized: '}{fmt(contractRecognized, c.currency)}</p>
                        <p className="text-xs text-orange-500">{tr ? 'Ertelenen: ' : 'Deferred: '}{fmt(c.totalValue - contractRecognized, c.currency)}</p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="ml-6 mt-2">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(progress, 100)}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{progress.toFixed(1)}% {tr ? 'tanındı' : 'recognized'}</p>
                    </div>
                  </div>

                  {/* Expanded: obligations */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">{tr ? 'Performans Yükümlülükleri (IFRS 15 Adım 2-3)' : 'Performance Obligations (IFRS 15 Step 2-3)'}</h3>
                        <button onClick={() => setShowScheduleModal(c)}
                          className="text-xs px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                          {tr ? 'Takvim Oluştur' : 'Generate Schedule'}
                        </button>
                      </div>
                      {c.obligations.map((obl, i) => (
                        <div key={i} className="bg-white rounded-xl p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">{obl.description}</p>
                              <p className="text-xs text-gray-500">{obl.recognitionMethod} · {obl.allocationPercent.toFixed(1)}% allocation</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">{fmt(obl.allocatedValue, c.currency)}</p>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${obl.status === 'completed' ? 'bg-green-100 text-green-700' : obl.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                {obl.status.replace('_',' ')}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {c.obligations.length === 0 && (
                        <p className="text-xs text-gray-400 text-center">{tr ? 'Yükümlülük tanımlanmadı.' : 'No obligations defined.'}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SCHEDULE VIEW */}
      {view === 'schedule' && (
        <div className="space-y-4">
          <div className="apple-card overflow-hidden">
            {schedules.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>{tr ? 'Tanıma takvimi bulunamadı.' : 'No recognition schedule found.'}</p>
                <p className="text-xs mt-1">{tr ? 'Sözleşme detayında takvim oluşturun.' : 'Generate schedule from contract detail.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[800px]">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Dönem' : 'Period'}</th>
                      <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Sözleşme' : 'Contract'}</th>
                      <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Yükümlülük' : 'Obligation'}</th>
                      <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Yöntem' : 'Method'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Planlanan' : 'Scheduled'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Tanınan' : 'Recognized'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Ertelenen' : 'Deferred'}</th>
                      <th className="text-center p-3 font-medium text-gray-600">{tr ? 'Durum' : 'Status'}</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.sort((a,b) => a.period.localeCompare(b.period)).map(s => (
                      <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="p-3 font-mono text-sm">{s.period}</td>
                        <td className="p-3">
                          <p className="font-medium text-sm">{s.contractNo}</p>
                          <p className="text-xs text-gray-400">{s.customerName}</p>
                        </td>
                        <td className="p-3 text-gray-600 text-sm">{s.obligationDesc}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700">{s.method.replace('_',' ')}</span>
                        </td>
                        <td className="p-3 text-right">{fmt(s.scheduledAmount)}</td>
                        <td className="p-3 text-right text-green-600">{fmt(s.recognizedAmount)}</td>
                        <td className="p-3 text-right text-orange-500">{fmt(s.deferredAmount)}</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${s.status === 'recognized' ? 'bg-green-100 text-green-700' : s.status === 'deferred' ? 'bg-orange-100 text-orange-700' : s.status === 'reversed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="p-3">
                          {s.status !== 'recognized' && (
                            <button onClick={() => recognizeRevenue(s)}
                              className="text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                              {tr ? 'Tanı' : 'Recognize'}
                            </button>
                          )}
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

      {/* DEFERRED REVENUE VIEW */}
      {view === 'deferred' && (
        <div className="space-y-4">
          <div className="apple-card p-4">
            <h3 className="font-semibold text-sm mb-4">{tr ? '12 Aylık Ertelenmiş Gelir Tahmini' : '12-Month Deferred Revenue Forecast'}</h3>
            <div className="flex items-end gap-2 h-32">
              {deferredByMonth.map((m, i) => {
                const height = maxDeferred > 0 ? (m.amount / maxDeferred) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-lg bg-emerald-200 hover:bg-emerald-300 transition-colors relative group"
                      style={{ height: `${height}%`, minHeight: m.amount > 0 ? 4 : 0 }}>
                      {m.amount > 0 && (
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          {fmt(m.amount)}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 rotate-45 origin-left translate-x-2">{m.period.slice(5)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Deferred revenue table grouped by contract */}
          <div className="apple-card overflow-hidden">
            <div className="p-3 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-semibold">{tr ? 'Sözleşme Bazlı Ertelenmiş Gelir' : 'Deferred Revenue by Contract'}</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Sözleşme' : 'Contract'}</th>
                  <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Müşteri' : 'Customer'}</th>
                  <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Toplam Değer' : 'Total Value'}</th>
                  <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Tanınan' : 'Recognized'}</th>
                  <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Ertelenen' : 'Deferred'}</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => {
                  const cs = schedules.filter(s => s.contractId === c.id);
                  const recognized = cs.reduce((s,r)=>s+r.recognizedAmount,0);
                  const deferred = cs.reduce((s,r)=>s+r.deferredAmount,0);
                  return (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="p-3 font-medium">{c.contractNo}</td>
                      <td className="p-3 text-gray-600">{c.customerName}</td>
                      <td className="p-3 text-right">{fmt(c.totalValue, c.currency)}</td>
                      <td className="p-3 text-right text-green-600">{fmt(recognized, c.currency)}</td>
                      <td className="p-3 text-right font-semibold text-orange-600">{fmt(deferred, c.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ANALYTICS VIEW */}
      {view === 'recognition' && (
        <div className="space-y-4">
          {/* IFRS 15 steps guide */}
          <div className="apple-card p-4">
            <h3 className="font-semibold text-sm mb-4">{tr ? 'IFRS 15 — 5 Adımlı Model' : 'IFRS 15 — 5-Step Model'}</h3>
            <div className="space-y-3">
              {[
                { step: 1, title: tr ? 'Müşteriyle sözleşmeyi belirle' : 'Identify the contract', desc: tr ? 'Ticari içerik, tahsilat olasılığı' : 'Commercial substance, collectability' },
                { step: 2, title: tr ? 'Performans yükümlülüklerini belirle' : 'Identify performance obligations', desc: tr ? 'Ayrı mal/hizmet vaaitleri' : 'Distinct goods/services promises' },
                { step: 3, title: tr ? 'İşlem fiyatını belirle' : 'Determine transaction price', desc: tr ? 'Değişken tutar, zaman değeri' : 'Variable consideration, time value' },
                { step: 4, title: tr ? 'Fiyatı yükümlülüklere dağıt' : 'Allocate transaction price', desc: tr ? 'Bağımsız satış fiyatı bazında' : 'Based on standalone selling prices' },
                { step: 5, title: tr ? 'Yükümlülük yerine getirilince tanı' : 'Recognize when obligation satisfied', desc: tr ? 'Anlık veya zamana yayılı' : 'At a point in time or over time' },
              ].map(s => (
                <div key={s.step} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-emerald-700">{s.step}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-gray-500">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Method distribution */}
          <div className="grid grid-cols-2 gap-4">
            <div className="apple-card p-4">
              <h3 className="font-semibold text-sm mb-3">{tr ? 'Tanıma Yöntemi Dağılımı' : 'Recognition Method Mix'}</h3>
              {(['straight_line','poc','milestone','output'] as const).map(method => {
                const count = contracts.filter(c => c.method === method).length;
                return (
                  <div key={method} className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-500 w-28 capitalize">{method.replace('_',' ')}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full"
                        style={{ width: contracts.length > 0 ? `${(count/contracts.length)*100}%` : '0%' }} />
                    </div>
                    <span className="text-xs font-medium w-4">{count}</span>
                  </div>
                );
              })}
            </div>

            <div className="apple-card p-4">
              <h3 className="font-semibold text-sm mb-3">{tr ? 'Sözleşme Durumu' : 'Contract Status'}</h3>
              {(['active','completed','on_hold','cancelled'] as const).map(status => {
                const count = contracts.filter(c => c.status === status).length;
                const color = status === 'active' ? 'bg-green-500' : status === 'completed' ? 'bg-blue-500' : status === 'on_hold' ? 'bg-yellow-500' : 'bg-red-400';
                return (
                  <div key={status} className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-500 w-28 capitalize">{status.replace('_',' ')}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color}`}
                        style={{ width: contracts.length > 0 ? `${(count/contracts.length)*100}%` : '0%' }} />
                    </div>
                    <span className="text-xs font-medium w-4">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CONTRACT FORM MODAL */}
      {showContractForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 w-full max-w-2xl space-y-4 shadow-2xl my-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tr ? 'Yeni Sözleşme (IFRS 15)' : 'New Contract (IFRS 15)'}</h2>
              <button onClick={() => setShowContractForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {/* Step 1 */}
            <div className="space-y-1">
              <p className="text-xs text-emerald-700 font-semibold">{tr ? 'ADIM 1: Sözleşmeyi Belirle' : 'STEP 1: Identify the Contract'}</p>
              <div className="grid grid-cols-2 gap-3">
                <input className="apple-input p-3 rounded-xl text-sm" placeholder={tr ? 'Sözleşme No *' : 'Contract No *'} value={cForm.contractNo} onChange={e=>setCForm(p=>({...p,contractNo:e.target.value}))} />
                <input className="apple-input p-3 rounded-xl text-sm" placeholder={tr ? 'Müşteri Adı *' : 'Customer Name *'} value={cForm.customerName} onChange={e=>setCForm(p=>({...p,customerName:e.target.value}))} />
                <input type="date" className="apple-input p-3 rounded-xl text-sm" value={cForm.contractDate} onChange={e=>setCForm(p=>({...p,contractDate:e.target.value}))} />
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" className="apple-input p-3 rounded-xl text-sm" placeholder={tr ? 'Toplam Değer' : 'Total Value'} value={cForm.totalValue || ''} onChange={e=>setCForm(p=>({...p,totalValue:Number(e.target.value)}))} />
                  <select className="apple-input p-3 rounded-xl text-sm" value={cForm.currency} onChange={e=>setCForm(p=>({...p,currency:e.target.value}))}>
                    <option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option>
                  </select>
                </div>
                <input type="date" className="apple-input p-3 rounded-xl text-sm" title="Start date" value={cForm.startDate} onChange={e=>setCForm(p=>({...p,startDate:e.target.value}))} />
                <input type="date" className="apple-input p-3 rounded-xl text-sm" title="End date" value={cForm.endDate} onChange={e=>setCForm(p=>({...p,endDate:e.target.value}))} />
              </div>
            </div>

            {/* Step 2+3 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-emerald-700 font-semibold">{tr ? 'ADIM 2-3: Performans Yükümlülükleri & Fiyat Dağıtımı' : 'STEP 2-3: Obligations & Price Allocation'}</p>
                <button onClick={addObligation} className="text-xs px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700">
                  <Plus className="w-3 h-3 inline mr-1" />{tr ? 'Yükümlülük Ekle' : 'Add Obligation'}
                </button>
              </div>
              {oblForms.map((o, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input className="apple-input p-2.5 rounded-xl text-sm col-span-2" placeholder={tr ? 'Açıklama' : 'Description'} value={o.description} onChange={e=>setOblForms(prev=>prev.map((x,j)=>j===i?{...x,description:e.target.value}:x))} />
                    <div>
                      <label className="text-xs text-gray-500">{tr ? 'Bağımsız Satış Fiyatı' : 'Standalone Price'}</label>
                      <input type="number" className="apple-input w-full p-2.5 rounded-xl text-sm mt-1" value={o.standalonePrice || ''} onChange={e=>setOblForms(prev=>prev.map((x,j)=>j===i?{...x,standalonePrice:Number(e.target.value)}:x))} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{tr ? 'Tanıma Yöntemi' : 'Recognition Method'}</label>
                      <select className="apple-input w-full p-2.5 rounded-xl text-sm mt-1" value={o.recognitionMethod} onChange={e=>setOblForms(prev=>prev.map((x,j)=>j===i?{...x,recognitionMethod:e.target.value as any}:x))}>
                        <option value="straight_line">{tr ? 'Doğrusal (Straight-line)' : 'Straight-line'}</option>
                        <option value="poc">{tr ? 'Tamamlanma Yüzdesi (PoC)' : 'Percentage of Completion'}</option>
                        <option value="milestone">{tr ? 'Kilometre Taşı (Milestone)' : 'Milestone'}</option>
                        <option value="output">{tr ? 'Çıktı Yöntemi (Output)' : 'Output Method'}</option>
                      </select>
                    </div>
                  </div>
                  <button onClick={() => setOblForms(prev => prev.filter((_,j)=>j!==i))} className="text-xs text-red-500 hover:text-red-700">
                    {tr ? 'Kaldır' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowContractForm(false)} className="apple-button-secondary flex-1 p-3 rounded-full text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={saveContract} className="apple-button-primary text-white flex-1 p-3 rounded-full text-sm">{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* GENERATE SCHEDULE MODAL */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h2 className="text-lg font-semibold">{tr ? 'Tanıma Takvimi Oluştur' : 'Generate Schedule'}</h2>
            <p className="text-sm text-gray-600">
              {showScheduleModal.contractNo} — {showScheduleModal.customerName}
              <br />
              <span className="text-xs text-gray-400">{showScheduleModal.startDate} → {showScheduleModal.endDate}</span>
            </p>
            <p className="text-sm text-gray-500">{tr ? 'Bu işlem sözleşmedeki tüm yükümlülükler için otomatik gelir takvimi oluşturacaktır.' : 'This will auto-generate revenue schedule entries for all obligations in this contract.'}</p>
            <div className="flex gap-3">
              <button onClick={() => setShowScheduleModal(null)} className="apple-button-secondary flex-1 p-3 rounded-full text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={() => generateSchedule(showScheduleModal)} className="apple-button-primary text-white flex-1 p-3 rounded-full text-sm">{tr ? 'Oluştur' : 'Generate'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
