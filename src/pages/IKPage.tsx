import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar, Users, UserCheck, Shield, Plus, Download, DollarSign,
} from 'lucide-react';
import { db } from '../firebase';
import { doc, collection, addDoc, updateDoc, serverTimestamp } from '../lib/dbClient';
import { cn } from '../lib/utils';
import { pushMikroEvrak, izinTalepPayload } from '../services/mikroEvrak';
import UnauthorizedView from '../components/UnauthorizedView';
import ReadOnlyBanner from '../components/ReadOnlyBanner';
import ModuleHeader from '../components/ModuleHeader';
import KpiCurrencyToggle from '../components/KpiCurrencyToggle';
import type { Order, Lead, Employee } from '../types';

const HRModule = React.lazy(() => import('../components/HRModule'));

interface LeaveRequest { id: string; employeeId: string; employeeName: string; type: 'annual' | 'sick' | 'unpaid' | 'other'; startDate: string; endDate: string; days: number; status: 'pending' | 'approved' | 'rejected'; reason?: string }
interface AttendanceRecord { id: string; employeeName: string; employeeId?: string; date: string; checkIn: string; checkOut: string; totalHours: number; status: 'Normal' | 'Geç Giriş' | 'Erken Çıkış' | 'Devamsız' | 'İzinli' }
interface Payroll636 { id: string; name: string; position: string; gross: number; sgkEmployee: number; sgkEmployer: number; incomeTax: number; stampTax: number; net: number }

interface Props {
  currentLanguage: 'tr' | 'en';
  canAccess: (tab: string) => boolean;
  hasFullAccess: (tab: string) => boolean;
  user: { email?: string | null; uid?: string; displayName?: string | null } | null;
  userRole: string | null;
  darkMode: boolean;
  orders: Order[];
  leads: Lead[];
  employees: Employee[];
  exchangeRates: Record<string, number> | null;
  fmtKpi: (value: number, format?: 'full' | 'K', decimals?: number) => string;
  toast: (msg: string, type?: string) => void;
  kpiCurrency: 'TRY' | 'USD' | 'EUR';
  setKpiCurrency: React.Dispatch<React.SetStateAction<'TRY' | 'USD' | 'EUR'>>;

  leaveRequests: LeaveRequest[];
  showLeaveForm: boolean;
  setShowLeaveForm: React.Dispatch<React.SetStateAction<boolean>>;
  leaveForm: { employeeName: string; type: 'annual' | 'sick' | 'unpaid' | 'other'; startDate: string; endDate: string; reason: string };
  setLeaveForm: React.Dispatch<React.SetStateAction<{ employeeName: string; type: 'annual' | 'sick' | 'unpaid' | 'other'; startDate: string; endDate: string; reason: string }>>;

  payrollMonth: string;
  setPayrollMonth: React.Dispatch<React.SetStateAction<string>>;
  payrollView: 'summary' | 'detail';
  setPayrollView: React.Dispatch<React.SetStateAction<'summary' | 'detail'>>;

  p552Records: AttendanceRecord[];
  p556Period: string;
  setP556Period: React.Dispatch<React.SetStateAction<string>>;
  p572SelEmpId: string;
  setP572SelEmpId: React.Dispatch<React.SetStateAction<string>>;
  p599Ratings: Record<string, Record<string, number>>;
  setP599Ratings: React.Dispatch<React.SetStateAction<Record<string, Record<string, number>>>>;
  p599SelEmp: string;
  setP599SelEmp: React.Dispatch<React.SetStateAction<string>>;
  p616Period: '3m' | '6m' | '12m';
  setP616Period: React.Dispatch<React.SetStateAction<'3m' | '6m' | '12m'>>;
  p629KpiPeriod: 'this_month' | 'last_month' | 'ytd';
  setP629KpiPeriod: React.Dispatch<React.SetStateAction<'this_month' | 'last_month' | 'ytd'>>;
  p636Month: string;
  setP636Month: React.Dispatch<React.SetStateAction<string>>;
  p636Payrolls: Payroll636[];
  setP636Payrolls: React.Dispatch<React.SetStateAction<Payroll636[]>>;
  p636Calculated: boolean;
  setP636Calculated: React.Dispatch<React.SetStateAction<boolean>>;
}

const p599Skills = ['Excel','ERP','Müşteri İlişkileri','Proje Yönetimi','Teknik Destek','Muhasebe','Lojistik','İngilizce','Satış'];

export default function IKPage(props: Props) {
  const {
    currentLanguage, canAccess, hasFullAccess, user, userRole, darkMode,
    orders, leads, employees, exchangeRates, fmtKpi, toast, kpiCurrency, setKpiCurrency,
    leaveRequests, showLeaveForm, setShowLeaveForm, leaveForm, setLeaveForm,
    payrollMonth, setPayrollMonth, payrollView, setPayrollView,
    p552Records, p556Period, setP556Period, p572SelEmpId, setP572SelEmpId,
    p599Ratings, setP599Ratings, p599SelEmp, setP599SelEmp,
    p616Period, setP616Period, p629KpiPeriod, setP629KpiPeriod,
    p636Month, setP636Month, p636Payrolls, setP636Payrolls, p636Calculated, setP636Calculated,
  } = props;

  return (
            <motion.div key="ik" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {!canAccess('ik') ? <UnauthorizedView currentLanguage={currentLanguage} tab={currentLanguage==='tr'?'İnsan Kaynakları':'Human Resources'} /> : (
                <>
                  {!hasFullAccess('ik') && <ReadOnlyBanner currentLanguage={currentLanguage} />}
                  <ModuleHeader
                    title={currentLanguage === 'tr' ? 'İnsan Kaynakları' : 'Human Resources'}
                    subtitle={currentLanguage === 'tr' ? 'Çalışan yönetimi, izin, seyahat, avans ve bordro' : 'Employee management, leave, travel, advance and payroll'}
                    icon={Users}
                  />
                  {/* ── Phase 61: Employee Status Ring Chart ── */}
                  {employees.length > 0 && (() => {
                    const aktif  = employees.filter(e => e.status === 'Aktif').length;
                    const izinli = employees.filter(e => e.status === 'İzinli').length;
                    const ayrildi = employees.filter(e => e.status === 'Ayrıldı').length;
                    const total  = employees.length;
                    const deptMap: Record<string, number> = {};
                    for (const e of employees) { if (e.status === 'Aktif') deptMap[e.department] = (deptMap[e.department] ?? 0) + 1; }
                    const topDepts = Object.entries(deptMap).sort(([, a], [, b]) => b - a).slice(0, 4);
                    return (
                      <div className={cn("rounded-2xl border p-5 grid grid-cols-1 sm:grid-cols-2 gap-6", darkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm")}>
                        {/* Status breakdown */}
                        <div>
                          <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4 flex items-center gap-2", darkMode ? "text-white/50" : "text-gray-400")}>
                            <Users className="w-3.5 h-3.5" />
                            {currentLanguage === 'tr' ? 'Çalışan Durumu' : 'Employee Status'}
                          </h3>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: currentLanguage === 'tr' ? 'Aktif' : 'Active',   count: aktif,   color: 'text-emerald-700', bg: 'bg-emerald-50'  },
                              { label: currentLanguage === 'tr' ? 'İzinli' : 'On Leave', count: izinli,  color: 'text-amber-700',   bg: 'bg-amber-50'    },
                              { label: currentLanguage === 'tr' ? 'Ayrıldı' : 'Left',   count: ayrildi, color: 'text-gray-500',    bg: 'bg-gray-50'     },
                            ].map((s, i) => (
                              <div key={i} className={cn("rounded-xl p-3 text-center", darkMode ? "bg-white/5" : s.bg)}>
                                <p className={`text-2xl font-black ${s.color}`}>{s.count}</p>
                                <p className={cn("text-[10px] font-bold mt-0.5", darkMode ? "text-white/50" : "text-gray-500")}>{s.label}</p>
                              </div>
                            ))}
                          </div>
                          {/* Active employees bar */}
                          <div className="mt-4 space-y-1">
                            <div className="flex justify-between text-[10px] text-gray-400">
                              <span>{currentLanguage === 'tr' ? 'Aktiflik oranı' : 'Active rate'}</span>
                              <span className="font-bold text-emerald-600">{total > 0 ? Math.round((aktif / total) * 100) : 0}%</span>
                            </div>
                            <div className={cn("h-2 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                              <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${total > 0 ? (aktif / total) * 100 : 0}%` }} />
                            </div>
                          </div>
                        </div>
                        {/* Department breakdown */}
                        <div>
                          <h3 className={cn("text-[10px] font-bold uppercase tracking-wider mb-4", darkMode ? "text-white/50" : "text-gray-400")}>
                            {currentLanguage === 'tr' ? 'Departman Dağılımı' : 'By Department'}
                          </h3>
                          <div className="space-y-2">
                            {topDepts.map(([dept, count]) => (
                              <div key={dept} className="flex items-center gap-2">
                                <p className={cn("text-[11px] w-24 truncate flex-shrink-0", darkMode ? "text-white/60" : "text-gray-600")}>{dept}</p>
                                <div className={cn("flex-1 h-2 rounded-full overflow-hidden", darkMode ? "bg-white/10" : "bg-gray-100")}>
                                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(count / aktif) * 100}%` }} />
                                </div>
                                <span className={cn("text-[11px] font-bold w-4 text-right flex-shrink-0", darkMode ? "text-white/60" : "text-gray-700")}>{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {/* ── Phase 117: Payroll Basic ── */}
                  {employees.length > 0 && (() => {
                    // Turkish payroll calculation (simplified)
                    const SGK_EMP    = 0.14;   // employee SGK
                    const UNEMP_EMP  = 0.01;   // employee unemployment insurance
                    const SGK_EMPL   = 0.205;  // employer SGK
                    const UNEMP_EMPL = 0.02;   // employer unemployment insurance
                    const incomeTax  = (taxBase: number) => {
                      let tax = 0, remaining = taxBase;
                      const brackets = [[70000, 0.15], [80000, 0.20], [220000, 0.27], [1530000, 0.35]] as [number, number][];
                      for (const [limit, rate] of brackets) {
                        if (remaining <= 0) break;
                        const chunk = Math.min(remaining, limit);
                        tax += chunk * rate;
                        remaining -= chunk;
                      }
                      if (remaining > 0) tax += remaining * 0.40;
                      return tax;
                    };

                    const activeEmps = employees.filter(e => e.status === 'Aktif');
                    const payroll = activeEmps.map(e => {
                      const gross = e.salary || 0;
                      const sgkEmp   = Math.round(gross * SGK_EMP);
                      const unempEmp = Math.round(gross * UNEMP_EMP);
                      const taxBase  = gross - sgkEmp - unempEmp;
                      const tax      = Math.round(incomeTax(taxBase));
                      const net      = gross - sgkEmp - unempEmp - tax;
                      const employerCost = gross + Math.round(gross * SGK_EMPL) + Math.round(gross * UNEMP_EMPL);
                      return { ...e, gross, sgkEmp, unempEmp, tax, net, employerCost };
                    });
                    const totals = payroll.reduce((acc, p) => ({
                      gross: acc.gross + p.gross, net: acc.net + p.net,
                      tax: acc.tax + p.tax, cost: acc.cost + p.employerCost,
                    }), { gross: 0, net: 0, tax: 0, cost: 0 });

                    return (
                      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <DollarSign size={16} className="text-gray-400" />
                            <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Bordro Özeti' : 'Payroll Summary'}</h3>
                          </div>
                          <div className="flex items-center gap-2">
                            <KpiCurrencyToggle kpiCurrency={kpiCurrency} setKpiCurrency={setKpiCurrency} />
                            <input type="month" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)} className="apple-input text-xs px-2 py-1" />
                            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                              {(['summary', 'detail'] as const).map(v => (
                                <button key={v} onClick={() => setPayrollView(v)}
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-all ${payrollView === v ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400'}`}>
                                  {v === 'summary' ? (currentLanguage === 'tr' ? 'Özet' : 'Summary') : (currentLanguage === 'tr' ? 'Detay' : 'Detail')}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {payrollView === 'summary' ? (
                          <div className="p-5">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                              {[
                                { label: currentLanguage === 'tr' ? 'Toplam Brüt' : 'Total Gross',  value: totals.gross, color: 'text-gray-800',    bg: 'bg-gray-50'   },
                                { label: currentLanguage === 'tr' ? 'Toplam Net'  : 'Total Net',    value: totals.net,   color: 'text-emerald-700', bg: 'bg-emerald-50' },
                                { label: currentLanguage === 'tr' ? 'Vergi'       : 'Income Tax',   value: totals.tax,   color: 'text-red-600',     bg: 'bg-red-50'    },
                                { label: currentLanguage === 'tr' ? 'İşveren Mlt' : 'Employer Cost', value: totals.cost, color: 'text-blue-700',    bg: 'bg-blue-50'   },
                              ].map((k, i) => (
                                <div key={i} className={`rounded-xl p-3 ${k.bg}`}>
                                  <p className="text-[10px] font-bold text-gray-400 mb-1">{k.label}</p>
                                  <p className={`text-lg font-black ${k.color}`}>{fmtKpi(k.value,'full',0)}</p>
                                </div>
                              ))}
                            </div>
                            <p className="text-[10px] text-gray-400">
                              {activeEmps.length} {currentLanguage === 'tr' ? 'aktif çalışan · SGK işçi %14 · Gelir Vergisi dilimli' : 'active employees · SGK employee 14% · Progressive income tax'}
                            </p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                  {[
                                    currentLanguage === 'tr' ? 'Çalışan' : 'Employee',
                                    currentLanguage === 'tr' ? 'Departman' : 'Dept',
                                    currentLanguage === 'tr' ? 'Brüt' : 'Gross',
                                    'SGK',
                                    currentLanguage === 'tr' ? 'Vergi' : 'Tax',
                                    currentLanguage === 'tr' ? 'Net' : 'Net',
                                    currentLanguage === 'tr' ? 'İşveren' : 'Employer Cost',
                                  ].map(h => (
                                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {payroll.map(p => (
                                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-2.5 font-semibold text-gray-800">{p.name}</td>
                                    <td className="px-4 py-2.5 text-gray-500">{p.department}</td>
                                    <td className="px-4 py-2.5 font-bold text-gray-800">{fmtKpi(p.gross)}</td>
                                    <td className="px-4 py-2.5 text-red-500">−{fmtKpi((p.sgkEmp + p.unempEmp))}</td>
                                    <td className="px-4 py-2.5 text-red-500">−{fmtKpi(p.tax)}</td>
                                    <td className="px-4 py-2.5 font-black text-emerald-700">{fmtKpi(p.net)}</td>
                                    <td className="px-4 py-2.5 text-blue-700 font-bold">{fmtKpi(p.employerCost)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="bg-gray-50 border-t-2 border-gray-200 font-black text-[11px]">
                                  <td colSpan={2} className="px-4 py-2.5 text-gray-600">{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</td>
                                  <td className="px-4 py-2.5 text-gray-800">{fmtKpi(totals.gross)}</td>
                                  <td className="px-4 py-2.5 text-red-500">—</td>
                                  <td className="px-4 py-2.5 text-red-500">{fmtKpi(totals.tax)}</td>
                                  <td className="px-4 py-2.5 text-emerald-700">{fmtKpi(totals.net)}</td>
                                  <td className="px-4 py-2.5 text-blue-700">{fmtKpi(totals.cost)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Phase 121: Leave Management ── */}
                  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar size={15} className="text-gray-400" />
                        <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'İzin Yönetimi' : 'Leave Management'}</h3>
                        {leaveRequests.filter(l => l.status === 'pending').length > 0 && (
                          <span className="bg-amber-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                            {leaveRequests.filter(l => l.status === 'pending').length} {currentLanguage === 'tr' ? 'bekliyor' : 'pending'}
                          </span>
                        )}
                      </div>
                      <button onClick={() => setShowLeaveForm(v => !v)} className="text-[10px] font-bold text-brand hover:underline flex items-center gap-1">
                        <Plus size={11} />{currentLanguage === 'tr' ? 'Talep Ekle' : 'Add Request'}
                      </button>
                    </div>

                    {/* Stats strip */}
                    <div className="grid grid-cols-3 divide-x divide-gray-50 border-b border-gray-50">
                      {[
                        { label: currentLanguage === 'tr' ? 'Bekliyor' : 'Pending',  count: leaveRequests.filter(l => l.status === 'pending').length,  color: 'text-amber-600' },
                        { label: currentLanguage === 'tr' ? 'Onaylı'   : 'Approved', count: leaveRequests.filter(l => l.status === 'approved').length, color: 'text-emerald-600' },
                        { label: currentLanguage === 'tr' ? 'Reddedildi' : 'Rejected', count: leaveRequests.filter(l => l.status === 'rejected').length, color: 'text-red-500' },
                      ].map((s, i) => (
                        <div key={i} className="py-3 text-center">
                          <p className={`text-xl font-black ${s.color}`}>{s.count}</p>
                          <p className="text-[10px] font-bold text-gray-400">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Form */}
                    <AnimatePresence>
                      {showLeaveForm && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                          <div className="p-4 bg-gray-50 border-b border-gray-100 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <input className="apple-input text-sm" placeholder={currentLanguage === 'tr' ? 'Çalışan adı' : 'Employee name'}
                                value={leaveForm.employeeName} onChange={e => setLeaveForm(f => ({ ...f, employeeName: e.target.value }))} />
                              <select className="apple-input text-sm" value={leaveForm.type} onChange={e => setLeaveForm(f => ({ ...f, type: e.target.value as typeof leaveForm.type }))}>
                                <option value="annual">{currentLanguage === 'tr' ? 'Yıllık İzin' : 'Annual Leave'}</option>
                                <option value="sick">{currentLanguage === 'tr' ? 'Hastalık' : 'Sick Leave'}</option>
                                <option value="unpaid">{currentLanguage === 'tr' ? 'Ücretsiz İzin' : 'Unpaid Leave'}</option>
                                <option value="other">{currentLanguage === 'tr' ? 'Diğer' : 'Other'}</option>
                              </select>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400">{currentLanguage === 'tr' ? 'Başlangıç' : 'Start'}</label>
                                <input type="date" className="apple-input text-sm" value={leaveForm.startDate} onChange={e => setLeaveForm(f => ({ ...f, startDate: e.target.value }))} />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400">{currentLanguage === 'tr' ? 'Bitiş' : 'End'}</label>
                                <input type="date" className="apple-input text-sm" value={leaveForm.endDate} onChange={e => setLeaveForm(f => ({ ...f, endDate: e.target.value }))} />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input className="apple-input text-sm flex-1" placeholder={currentLanguage === 'tr' ? 'Açıklama (opsiyonel)' : 'Reason (optional)'}
                                value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} />
                              <button
                                disabled={!leaveForm.employeeName || !leaveForm.startDate || !leaveForm.endDate}
                                onClick={async () => {
                                  if (!leaveForm.employeeName || !leaveForm.startDate || !leaveForm.endDate) return;
                                  const start = new Date(leaveForm.startDate);
                                  const end   = new Date(leaveForm.endDate);
                                  const days  = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1);
                                  const emp = employees.find(e => e.name.toLowerCase().includes(leaveForm.employeeName.toLowerCase()));
                                  await addDoc(collection(db, 'leaveRequests'), {
                                    ...leaveForm, days, status: 'pending',
                                    employeeId: emp?.id || '', createdAt: serverTimestamp(),
                                  });
                                  setLeaveForm({ employeeName: '', type: 'annual', startDate: '', endDate: '', reason: '' });
                                  setShowLeaveForm(false);
                                  toast(currentLanguage === 'tr' ? 'İzin talebi oluşturuldu.' : 'Leave request created.', 'success');
                                }}
                                className="apple-button-primary text-xs px-4 disabled:opacity-50"
                              >{currentLanguage === 'tr' ? 'Talep Et' : 'Submit'}</button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Request list */}
                    {leaveRequests.length === 0 ? (
                      <div className="py-8 text-center">
                        <Calendar size={28} className="mx-auto mb-2 text-gray-200" />
                        <p className="text-xs text-gray-400">{currentLanguage === 'tr' ? 'İzin talebi yok.' : 'No leave requests.'}</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                        {leaveRequests.map(lr => {
                          const typeLabel = { annual: currentLanguage === 'tr' ? 'Yıllık' : 'Annual', sick: currentLanguage === 'tr' ? 'Hastalık' : 'Sick', unpaid: currentLanguage === 'tr' ? 'Ücretsiz' : 'Unpaid', other: currentLanguage === 'tr' ? 'Diğer' : 'Other' }[lr.type] || lr.type;
                          return (
                            <div key={lr.id} className="flex items-center gap-3 px-5 py-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-800">{lr.employeeName}</p>
                                <p className="text-[10px] text-gray-400">{typeLabel} · {lr.startDate} → {lr.endDate} · {lr.days} {currentLanguage === 'tr' ? 'gün' : 'days'}</p>
                              </div>
                              {lr.status === 'pending' && hasFullAccess('ik') ? (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <button onClick={async () => {
                                    await updateDoc(doc(db, 'leaveRequests', lr.id), { status: 'approved' });
                                    toast(currentLanguage === 'tr' ? 'Onaylandı.' : 'Approved.', 'success');
                                    // Onaylanan izni Mikro'ya da gönder (hata lokali engellemez, syncLog'da görünür)
                                    pushMikroEvrak('PersonelIzinTalepKaydetV2', izinTalepPayload({
                                      persKod: ((lr as unknown as { mikroPersKod?: string }).mikroPersKod ?? lr.employeeName ?? '').slice(0, 15),
                                      startDate: lr.startDate,
                                      days: Number(lr.days) || 1,
                                      reason: `${lr.type ?? ''}`,
                                    }), { entityType: 'leaveRequest', entityId: lr.id }).catch(() => {});
                                  }}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">
                                    {currentLanguage === 'tr' ? 'Onayla' : 'Approve'}
                                  </button>
                                  <button onClick={async () => { await updateDoc(doc(db, 'leaveRequests', lr.id), { status: 'rejected' }); }}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
                                    {currentLanguage === 'tr' ? 'Reddet' : 'Reject'}
                                  </button>
                                </div>
                              ) : (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                  lr.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                                  : lr.status === 'rejected' ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {lr.status === 'approved' ? (currentLanguage === 'tr' ? '✓ Onaylı' : '✓ Approved')
                                    : lr.status === 'rejected' ? (currentLanguage === 'tr' ? '✗ Reddedildi' : '✗ Rejected')
                                    : (currentLanguage === 'tr' ? '⏳ Bekliyor' : '⏳ Pending')}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Phase 128: Employee Performance Dashboard ── */}
                  {employees.length > 0 && (() => {
                    // Build per-department headcount and salary data
                    type DeptStat = { dept: string; count: number; totalSalary: number; active: number };
                    const deptMap: Record<string, DeptStat> = {};
                    for (const emp of employees) {
                      const dept = emp.department || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
                      if (!deptMap[dept]) deptMap[dept] = { dept, count: 0, totalSalary: 0, active: 0 };
                      deptMap[dept].count++;
                      deptMap[dept].totalSalary += emp.salary || 0;
                      if (emp.status === 'Aktif') deptMap[dept].active++;
                    }
                    const depts = Object.values(deptMap).sort((a, b) => b.count - a.count);
                    const totalHeadcount = employees.length;
                    const totalActive = employees.filter(e => e.status === 'Aktif').length;
                    const totalSalaryBudget = employees.reduce((s, e) => s + (e.salary || 0), 0);
                    return (
                      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-base">👥</span>
                            <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Personel Özeti' : 'Employee Overview'}</h3>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span>{totalActive}/{totalHeadcount} {currentLanguage === 'tr' ? 'aktif' : 'active'}</span>
                            <span>{fmtKpi(totalSalaryBudget,'K',0)} {currentLanguage === 'tr' ? 'bordro' : 'payroll'}</span>
                          </div>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {depts.slice(0, 6).map(d => (
                            <div key={d.dept} className="flex items-center gap-4 px-5 py-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-800 truncate">{d.dept}</p>
                                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden mt-1">
                                  <div className="h-1.5 bg-brand/60 rounded-full transition-all duration-700" style={{ width: `${(d.count / Math.max(...depts.map(x => x.count))) * 100}%` }} />
                                </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0 text-right">
                                <span className="text-xs font-bold text-gray-700">{d.count} {currentLanguage === 'tr' ? 'kişi' : 'staff'}</span>
                                <span className="text-[10px] text-gray-400">{fmtKpi(d.totalSalary,'K',0)}</span>
                                {d.active < d.count && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{d.count - d.active} {currentLanguage === 'tr' ? 'pasif' : 'inactive'}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 138: Leave Calendar ── */}
                  {leaveRequests.filter(l => l.status === 'approved').length > 0 && (() => {
                    const approved = leaveRequests.filter(l => l.status === 'approved');
                    const today138 = new Date();
                    const thisMonth138 = today138.getMonth();
                    const thisYear138 = today138.getFullYear();
                    // Show leaves active in current month
                    const current = approved.filter(l => {
                      const start = l.startDate ? new Date(l.startDate) : null;
                      const end = l.endDate ? new Date(l.endDate) : null;
                      if (!start || !end) return false;
                      return (
                        (start.getFullYear() === thisYear138 && start.getMonth() === thisMonth138) ||
                        (end.getFullYear() === thisYear138 && end.getMonth() === thisMonth138) ||
                        (start <= today138 && end >= today138)
                      );
                    });
                    if (current.length === 0) return null;
                    return (
                      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                          <Calendar size={16} className="text-purple-400" />
                          <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Bu Ay İzinli Personel' : 'Employees on Leave This Month'}</h3>
                          <span className="ml-auto text-[10px] font-bold text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full">{current.length}</span>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {current.map(l => {
                            const typeLabel = { annual: currentLanguage === 'tr' ? 'Yıllık' : 'Annual', sick: currentLanguage === 'tr' ? 'Hastalık' : 'Sick', unpaid: currentLanguage === 'tr' ? 'Ücretsiz' : 'Unpaid', other: currentLanguage === 'tr' ? 'Diğer' : 'Other' }[l.type] || l.type;
                            const isNow = l.startDate && l.endDate && new Date(l.startDate) <= today138 && new Date(l.endDate) >= today138;
                            return (
                              <div key={l.id} className="flex items-center gap-4 px-5 py-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-bold text-gray-800">{l.employeeName}</p>
                                    {isNow && <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{currentLanguage === 'tr' ? '🟢 Şu an' : '🟢 Now'}</span>}
                                  </div>
                                  <p className="text-[10px] text-gray-400">{typeLabel} · {l.startDate} → {l.endDate}</p>
                                </div>
                                <span className="text-xs font-bold text-gray-600 flex-shrink-0">{l.days} {currentLanguage === 'tr' ? 'gün' : 'd'}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 572: Çalışan Performans Skorkartı ─────────────────────────── */}
                  {employees.length > 0 && (() => {
                    const tr572 = currentLanguage === 'tr';
                    const selEmp = p572SelEmpId ? employees.find(e => e.id === p572SelEmpId) : employees[0];
                    if (!selEmp) return null;

                    // Derive metrics from available data
                    const empOrders = orders.filter(o => o.assignedTo === selEmp.id || o.assignedTo === selEmp.email).length;
                    const empLeads = leads.filter(l => l.assignedTo === selEmp.email || l.assignedTo === selEmp.name).length;
                    const empClosedLeads = leads.filter(l => (l.assignedTo === selEmp.email || l.assignedTo === selEmp.name) && (l.status === 'Closed Won' || l.status === 'Closed')).length;
                    const convRate = empLeads > 0 ? (empClosedLeads / empLeads) * 100 : 0;
                    const attendance = p552Records.filter(r => r.employeeName === selEmp.name && r.status === 'Normal').length;
                    const totalDays = p552Records.filter(r => r.employeeName === selEmp.name).length;
                    const attendancePct = totalDays > 0 ? (attendance / totalDays) * 100 : 0;

                    const kpis572 = [
                      { label: tr572?'Atanan Sipariş':'Assigned Orders', val: empOrders, max: Math.max(...employees.map(e => orders.filter(o => o.assignedTo===e.id||o.assignedTo===e.email).length), 1), unit: '', color: 'blue' },
                      { label: tr572?'Müşteri Adayı':'Assigned Leads', val: empLeads, max: Math.max(...employees.map(e => leads.filter(l => l.assignedTo===e.email||l.assignedTo===e.name).length), 1), unit: '', color: 'purple' },
                      { label: tr572?'Dönüşüm Oranı':'Conversion Rate', val: convRate, max: 100, unit: '%', color: 'emerald' },
                      { label: tr572?'Devam Oranı':'Attendance Rate', val: attendancePct || 100, max: 100, unit: '%', color: 'amber' },
                    ];

                    return (
                      <div className="apple-card p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                          <div className="flex items-center gap-2">
                            <UserCheck className="w-4 h-4 text-brand" />
                            <h4 className="font-bold text-gray-800 text-sm">{tr572?'Çalışan Performans Skorkartı':'Employee Performance Scorecard'}</h4>
                          </div>
                          <select className="apple-input text-sm px-3 py-1.5 max-w-xs" value={p572SelEmpId || (employees[0]?.id || '')}
                            onChange={e => setP572SelEmpId(e.target.value)}>
                            {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.department}</option>)}
                          </select>
                        </div>

                        {/* Employee card */}
                        <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-xl">
                          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center font-black text-brand text-lg flex-shrink-0">
                            {selEmp.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-gray-800">{selEmp.name}</p>
                            <p className="text-xs text-gray-500">{selEmp.position} · {selEmp.department}</p>
                          </div>
                          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${selEmp.status==='Aktif'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-600'}`}>{selEmp.status}</span>
                        </div>

                        {/* KPI grid */}
                        <div className="grid grid-cols-2 gap-3">
                          {kpis572.map(k => {
                            const pct = k.max > 0 ? Math.min((k.val / k.max) * 100, 100) : 0;
                            const colorMap = { blue:'text-blue-700 bg-blue-50 bg-blue-500', purple:'text-purple-700 bg-purple-50 bg-purple-500', emerald:'text-emerald-700 bg-emerald-50 bg-emerald-500', amber:'text-amber-700 bg-amber-50 bg-amber-400' };
                            const [tc, bg, bar] = (colorMap[k.color as keyof typeof colorMap] || colorMap.blue).split(' ');
                            return (
                              <div key={k.label} className={`rounded-xl p-3 ${bg}`}>
                                <p className="text-[10px] font-bold text-gray-400 mb-1">{k.label}</p>
                                <p className={`text-xl font-black ${tc}`}>{k.unit === '%' ? `${k.val.toFixed(1)}%` : k.val}</p>
                                <div className="h-1.5 bg-white/50 rounded-full overflow-hidden mt-1.5">
                                  <div className={`h-full ${bar} rounded-full`} style={{width:`${pct}%`}} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 556: SGK e-Bildirge ────────────────────────────────────────── */}
                  {employees.length > 0 && (() => {
                    const tr556 = currentLanguage === 'tr';
                    const SGK_EMP    = 0.14;
                    const UNEMP_EMP  = 0.01;
                    const SGK_EMPL   = 0.205;
                    const UNEMP_EMPL = 0.02;
                    const STAMP_RATE = 0.00759; // Damga vergisi oranı

                    const activeEmps = employees.filter(e => e.status === 'Aktif');
                    const [pYear, pMonthStr] = p556Period.split('-');
                    const pMonth = Number(pMonthStr);
                    const monthNames = tr556
                      ? ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']
                      : ['January','February','March','April','May','June','July','August','September','October','November','December'];
                    const periodLabel = `${monthNames[pMonth-1]} ${pYear}`;

                    const rows = activeEmps.map(e => {
                      const gross = e.salary || 0;
                      const sgkBase = gross;
                      const sgkEmp  = Math.round(sgkBase * SGK_EMP);
                      const unempEmp = Math.round(sgkBase * UNEMP_EMP);
                      const sgkEmpl  = Math.round(sgkBase * SGK_EMPL);
                      const unempEmpl = Math.round(sgkBase * UNEMP_EMPL);
                      const taxBase = gross - sgkEmp - unempEmp;
                      const stamp = Math.round(gross * STAMP_RATE);
                      const totalDeductions = sgkEmp + unempEmp;
                      const totalEmployerSgk = sgkEmpl + unempEmpl;
                      const netSalary = gross - sgkEmp - unempEmp - stamp;
                      return { emp: e, gross, sgkBase, sgkEmp, unempEmp, sgkEmpl, unempEmpl, taxBase, stamp, totalDeductions, totalEmployerSgk, netSalary };
                    });

                    const totals = rows.reduce((acc, r) => ({
                      gross: acc.gross + r.gross,
                      sgkBase: acc.sgkBase + r.sgkBase,
                      sgkEmp: acc.sgkEmp + r.sgkEmp,
                      unempEmp: acc.unempEmp + r.unempEmp,
                      sgkEmpl: acc.sgkEmpl + r.sgkEmpl,
                      unempEmpl: acc.unempEmpl + r.unempEmpl,
                      stamp: acc.stamp + r.stamp,
                      totalEmployerSgk: acc.totalEmployerSgk + r.totalEmployerSgk,
                      netSalary: acc.netSalary + r.netSalary,
                    }), { gross:0, sgkBase:0, sgkEmp:0, unempEmp:0, sgkEmpl:0, unempEmpl:0, stamp:0, totalEmployerSgk:0, netSalary:0 });

                    return (
                      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center">
                              <Shield className="w-4 h-4 text-teal-600" />
                            </div>
                            <div>
                              <h3 className="font-bold text-gray-800">{tr556 ? 'SGK e-Bildirge Raporu' : 'SGK e-Declaration Report'}</h3>
                              <p className="text-[10px] text-gray-400">{tr556 ? 'Aylık SGK prim bildirgesi özeti' : 'Monthly SGK premium declaration summary'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="month" value={p556Period} onChange={e => setP556Period(e.target.value)}
                              className="apple-input text-xs px-3 py-1.5" />
                            <button onClick={() => {
                              const lines = [
                                `SGK e-Bildirge — ${periodLabel}`,
                                '',
                                ['TC/Çalışan', 'Brüt Ücret', 'SGK Matrahı', 'SGK İşçi (%14)', 'İşsizlik İşçi (%1)', 'SGK İşveren (%20.5)', 'İşsizlik İşveren (%2)', 'Damga Vergisi', 'Net Ücret'].join('\t'),
                                ...rows.map(r => [
                                  r.emp.name, r.gross, r.sgkBase, r.sgkEmp, r.unempEmp, r.sgkEmpl, r.unempEmpl, r.stamp, r.netSalary
                                ].join('\t')),
                                '',
                                ['TOPLAM', totals.gross, totals.sgkBase, totals.sgkEmp, totals.unempEmp, totals.sgkEmpl, totals.unempEmpl, totals.stamp, totals.netSalary].join('\t'),
                              ].join('\n');
                              const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = `sgk-bildirge-${p556Period}.txt`; a.click();
                              URL.revokeObjectURL(url);
                              toast(tr556 ? 'SGK raporu indirildi.' : 'SGK report downloaded.', 'success');
                            }} className="flex items-center gap-1.5 text-xs font-semibold text-teal-600 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors">
                              <Download className="w-3.5 h-3.5" />{tr556 ? 'TXT İndir' : 'Download TXT'}
                            </button>
                          </div>
                        </div>

                        {/* Summary cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
                          {[
                            { label: tr556 ? 'Toplam Brüt' : 'Total Gross',        val: totals.gross,           color: 'text-gray-800' },
                            { label: tr556 ? 'SGK Matrahı' : 'SGK Base',           val: totals.sgkBase,         color: 'text-teal-700' },
                            { label: tr556 ? 'İşçi SGK+İşsizlik' : 'Employee SGK', val: totals.sgkEmp + totals.unempEmp, color: 'text-red-600' },
                            { label: tr556 ? 'İşveren SGK+İşsizlik' : 'Employer SGK', val: totals.totalEmployerSgk, color: 'text-blue-700' },
                          ].map(k => (
                            <div key={k.label} className="bg-white p-4">
                              <p className="text-[10px] font-bold text-gray-400 mb-1">{k.label}</p>
                              <p className={`text-lg font-black ${k.color}`}>{fmtKpi(k.val,'full',0)}</p>
                            </div>
                          ))}
                        </div>

                        {/* Period + totals info */}
                        <div className="px-5 py-3 bg-teal-50 border-b border-teal-100 flex flex-wrap gap-4 text-xs text-teal-800">
                          <span className="font-bold">{tr556 ? 'Dönem:' : 'Period:'} {periodLabel}</span>
                          <span>·</span>
                          <span>{activeEmps.length} {tr556 ? 'Aktif Çalışan' : 'Active Employees'}</span>
                          <span>·</span>
                          <span>{tr556 ? 'SGK İşçi: %14 | İşsizlik İşçi: %1 | SGK İşveren: %20,5 | İşsizlik İşveren: %2' : 'SGK Emp: 14% | Unemp Emp: 1% | SGK Empl: 20.5% | Unemp Empl: 2%'}</span>
                        </div>

                        {/* Detail table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                {[
                                  tr556?'Çalışan':'Employee',
                                  tr556?'Departman':'Dept',
                                  tr556?'Brüt':'Gross',
                                  tr556?'SGK Matrahı':'SGK Base',
                                  tr556?'SGK İşçi':'SGK Emp',
                                  tr556?'İşsizlik İşçi':'Unemp Emp',
                                  tr556?'SGK İşveren':'SGK Empl',
                                  tr556?'İşsizlik İşveren':'Unemp Empl',
                                  tr556?'Damga':'Stamp',
                                  tr556?'Net':'Net',
                                ].map(h => (
                                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {rows.map(r => (
                                <tr key={r.emp.id} className="hover:bg-gray-50/50 transition-colors">
                                  <td className="px-3 py-2.5 font-semibold text-gray-800 whitespace-nowrap">{r.emp.name}</td>
                                  <td className="px-3 py-2.5 text-gray-500">{r.emp.department}</td>
                                  <td className="px-3 py-2.5 font-bold text-gray-800 font-mono">{r.gross.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-teal-700 font-mono">{r.sgkBase.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-red-500 font-mono">−{r.sgkEmp.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-red-400 font-mono">−{r.unempEmp.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-blue-600 font-mono">{r.sgkEmpl.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-blue-400 font-mono">{r.unempEmpl.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 text-amber-600 font-mono">−{r.stamp.toLocaleString('tr-TR')}</td>
                                  <td className="px-3 py-2.5 font-bold text-emerald-700 font-mono">{r.netSalary.toLocaleString('tr-TR')}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                                <td className="px-3 py-2.5 text-gray-700 text-[10px] uppercase" colSpan={2}>{tr556 ? 'TOPLAM' : 'TOTAL'}</td>
                                <td className="px-3 py-2.5 text-gray-800 font-mono">{totals.gross.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-teal-700 font-mono">{totals.sgkBase.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-red-500 font-mono">−{totals.sgkEmp.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-red-400 font-mono">−{totals.unempEmp.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-blue-600 font-mono">{totals.sgkEmpl.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-blue-400 font-mono">{totals.unempEmpl.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-amber-600 font-mono">−{totals.stamp.toLocaleString('tr-TR')}</td>
                                <td className="px-3 py-2.5 text-emerald-700 font-mono">{totals.netSalary.toLocaleString('tr-TR')}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                        <p className="px-5 py-3 text-[10px] text-gray-400 border-t border-gray-50">
                          {tr556 ? '* Bu rapor hesaplanmış tahmini değerleri göstermektedir. Resmi SGK bildirgesini Mali Müşavirinizle birlikte hazırlayınız.' : '* This report shows calculated estimated values. Prepare the official SGK declaration with your CPA.'}
                        </p>
                      </div>
                    );
                  })()}

                  {/* ── Phase 599: Çalışan Yetkinlik Matrisi (Skill Matrix) ─────── */}
                  {(() => {
                    const tr599 = currentLanguage === 'tr';
                    if (employees.length === 0) return null;
                    const selEmp = employees.find(e => e.id === p599SelEmp) || employees[0];
                    const ratings = p599Ratings[selEmp?.id || ''] || {};
                    const avgScore = p599Skills.length > 0
                      ? p599Skills.reduce((s, sk) => s + (ratings[sk] || 0), 0) / p599Skills.length
                      : 0;
                    return (
                      <div className="apple-card p-5">
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">{tr599 ? '🧠 Yetkinlik Matrisi' : '🧠 Employee Skill Matrix'}</h3>
                          <select value={p599SelEmp || selEmp?.id} onChange={e => setP599SelEmp(e.target.value)} className="apple-input px-3 py-2 text-sm">
                            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </div>
                        {selEmp && (
                          <>
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand font-bold text-sm">{selEmp.name.charAt(0)}</div>
                              <div>
                                <p className="font-semibold text-gray-800">{selEmp.name}</p>
                                <p className="text-xs text-gray-500">{selEmp.position} • {selEmp.department}</p>
                              </div>
                              <div className="ml-auto text-right">
                                <p className="text-xs text-gray-400">{tr599 ? 'Ort. Yetkinlik' : 'Avg. Skill'}</p>
                                <p className={`text-xl font-bold ${avgScore >= 4 ? 'text-emerald-600' : avgScore >= 2.5 ? 'text-amber-600' : 'text-red-500'}`}>{avgScore.toFixed(1)}/5</p>
                              </div>
                            </div>
                            <div className="space-y-3">
                              {p599Skills.map(sk => {
                                const score = ratings[sk] || 0;
                                return (
                                  <div key={sk} className="flex items-center gap-3">
                                    <span className="text-xs text-gray-700 font-medium w-36 truncate">{sk}</span>
                                    <div className="flex gap-1">
                                      {[1,2,3,4,5].map(n => (
                                        <button key={n} onClick={() => hasFullAccess('ik') && setP599Ratings(prev => ({
                                          ...prev,
                                          [selEmp.id]: { ...(prev[selEmp.id] || {}), [sk]: n }
                                        }))}
                                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${score >= n ? 'bg-brand text-white' : 'bg-gray-100 text-gray-400 hover:bg-brand/20'}`}>
                                          {n}
                                        </button>
                                      ))}
                                    </div>
                                    <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${score >= 4 ? 'bg-emerald-400' : score >= 3 ? 'bg-amber-400' : 'bg-gray-300'}`} style={{ width: `${(score / 5) * 100}%` }} />
                                    </div>
                                    <span className={`text-xs font-bold w-6 text-right ${score >= 4 ? 'text-emerald-600' : score >= 3 ? 'text-amber-600' : 'text-gray-400'}`}>{score || '—'}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  <HRModule currentLanguage={currentLanguage} isAuthenticated={!!user && hasFullAccess('ik')} userRole={userRole} employees={employees} exchangeRates={exchangeRates} />

                  {/* ── Phase 616: Çalışan Devir Analizi ────────────────────────── */}
                  {employees.length > 0 && (() => {
                    const tr616 = currentLanguage === 'tr';
                    const daysMap:{[k:string]:number} = {'3m':90,'6m':180,'12m':365};
                    const days616 = daysMap[p616Period];
                    const cutoff616 = new Date(Date.now()-days616*86400000).toISOString().slice(0,10);
                    const activeEmps = employees.filter(e=>e.status==='Aktif').length;
                    const leftEmps = employees.filter(e=>e.status==='Ayrıldı'&&e.startDate>=cutoff616).length;
                    const turnoverRate = activeEmps+leftEmps>0?(leftEmps/(activeEmps+leftEmps)*100):0;
                    const byDept:{[dept:string]:{active:number;left:number}} = {};
                    employees.forEach(e=>{
                      if(!byDept[e.department]) byDept[e.department]={active:0,left:0};
                      if(e.status==='Aktif') byDept[e.department].active++;
                      else if(e.status==='Ayrıldı'&&e.startDate>=cutoff616) byDept[e.department].left++;
                    });
                    const deptRows = Object.entries(byDept).map(([dept,d])=>({dept,...d,rate:d.active+d.left>0?(d.left/(d.active+d.left)*100):0})).sort((a,b)=>b.rate-a.rate);
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">📉 {tr616?'Çalışan Devir Analizi':'Employee Turnover Analysis'}</h3>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'3m',l:'3M'},{k:'6m',l:'6M'},{k:'12m',l:'12M'}] as {k:'3m'|'6m'|'12m';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP616Period(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p616Period===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr616?'Aktif':'Active'}</p><p className="text-xl font-black text-blue-600">{activeEmps}</p></div>
                          <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr616?'Ayrılan':'Left'}</p><p className="text-xl font-black text-red-600">{leftEmps}</p></div>
                          <div className={`rounded-xl p-3 ${turnoverRate>15?'bg-red-50':turnoverRate>8?'bg-amber-50':'bg-emerald-50'}`}><p className="text-[10px] font-bold text-gray-400 uppercase">{tr616?'Devir Oranı':'Turnover Rate'}</p><p className={`text-xl font-black ${turnoverRate>15?'text-red-600':turnoverRate>8?'text-amber-600':'text-emerald-600'}`}>%{turnoverRate.toFixed(1)}</p></div>
                        </div>
                        <div className="space-y-2">
                          {deptRows.filter(r=>r.active+r.left>0).map(r=>(
                            <div key={r.dept} className="flex items-center gap-3">
                              <span className="text-xs text-gray-700 font-medium w-32 truncate shrink-0">{r.dept}</span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${r.rate>15?'bg-red-400':r.rate>8?'bg-amber-400':'bg-emerald-400'}`} style={{width:`${Math.min(r.rate*2,100)}%`}}/>
                              </div>
                              <span className={`text-xs font-bold shrink-0 w-10 text-right ${r.rate>15?'text-red-600':r.rate>8?'text-amber-600':'text-emerald-600'}`}>%{r.rate.toFixed(0)}</span>
                              <span className="text-xs text-gray-400 shrink-0">{r.left}/{r.active+r.left}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 629: Çalışan Performans KPI ──────────────────────── */}
                  {employees.length > 0 && (() => {
                    const tr629 = currentLanguage === 'tr';
                    const now629 = new Date();
                    let start629: Date;
                    if (p629KpiPeriod==='this_month') start629 = new Date(now629.getFullYear(), now629.getMonth(), 1);
                    else if (p629KpiPeriod==='last_month') start629 = new Date(now629.getFullYear(), now629.getMonth()-1, 1);
                    else start629 = new Date(now629.getFullYear(), 0, 1);
                    const end629 = p629KpiPeriod==='last_month'?new Date(now629.getFullYear(), now629.getMonth(), 0):now629;
                    // Sales per rep in period
                    const repSales:{[name:string]:{orders:number;revenue:number}} = {};
                    orders.filter(o=>{
                      if(o.status==='Cancelled'||!o.assignedTo||!o.createdAt) return false;
                      try { const d=(o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string); return d>=start629&&d<=end629; } catch { return false; }
                    }).forEach(o=>{ const r=o.assignedTo!; if(!repSales[r]) repSales[r]={orders:0,revenue:0}; repSales[r].orders++; repSales[r].revenue+=(o.totalPrice||0); });
                    const rows = employees.filter(e=>e.status==='Aktif').map(e=>({...e,sales:repSales[e.name]||{orders:0,revenue:0}})).sort((a,b)=>b.sales.revenue-a.sales.revenue);
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h3 className="font-bold text-gray-900 text-sm">🏆 {tr629?'Çalışan Performans KPI':'Employee Performance KPI'}</h3>
                          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {([{k:'this_month',l:tr629?'Bu Ay':'This M.'},{k:'last_month',l:tr629?'Geçen':'Last M.'},{k:'ytd',l:'YTD'}] as {k:'this_month'|'last_month'|'ytd';l:string}[]).map(t=>(
                              <button key={t.k} onClick={()=>setP629KpiPeriod(t.k)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${p629KpiPeriod===t.k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
                            ))}
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-100 bg-gray-50">
                              {['#',tr629?'Çalışan':'Employee',tr629?'Departman':'Dept',tr629?'Sipariş':'Orders',tr629?'Ciro':'Revenue'].map(h=>(
                                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-50">
                              {rows.slice(0,10).map((e,idx)=>(
                                <tr key={e.id} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5 text-gray-400">{idx+1}</td>
                                  <td className="px-3 py-2.5 font-medium text-gray-800">{e.name}</td>
                                  <td className="px-3 py-2.5 text-gray-500">{e.department}</td>
                                  <td className="px-3 py-2.5 font-bold text-blue-600">{e.sales.orders}</td>
                                  <td className="px-3 py-2.5 font-bold text-emerald-600">₺{Math.round(e.sales.revenue).toLocaleString('tr-TR')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Phase 636: SGK/Net Bordro Hesaplama Motoru ─────────────── */}
                  {employees.length > 0 && (() => {
                    const tr636 = currentLanguage === 'tr';
                    const calcPayroll = () => {
                      const rows = employees.filter(e=>e.status==='Aktif').map(e=>{
                        const gross = e.salary||0;
                        const sgkEmp = Math.round(gross*0.14);
                        const sgkEmpr = Math.round(gross*0.2075);
                        const taxableBase = gross - sgkEmp;
                        const incomeTax = Math.round(taxableBase<=32000?taxableBase*0.15:taxableBase<=70000?32000*0.15+(taxableBase-32000)*0.20:32000*0.15+38000*0.20+(taxableBase-70000)*0.27);
                        const stampTax = Math.round(gross*0.00759);
                        const net = gross - sgkEmp - incomeTax - stampTax;
                        return {id:e.id,name:e.name,position:e.position,gross,sgkEmployee:sgkEmp,sgkEmployer:sgkEmpr,incomeTax,stampTax,net};
                      });
                      setP636Payrolls(rows);
                      setP636Calculated(true);
                      // KALICI (2026-07-21): her hesaplama koşusu tarihli kayıt olarak saklanır;
                      // reload'da son koşu geri yüklenir (App aboneliği).
                      void addDoc(collection(db,'payrollRuns'),{rows,calculatedAt:serverTimestamp()}).catch(()=>{});
                    };
                    const totalGross = p636Payrolls.reduce((s,r)=>s+r.gross,0);
                    const totalNet = p636Payrolls.reduce((s,r)=>s+r.net,0);
                    const totalSgkEmployer = p636Payrolls.reduce((s,r)=>s+r.sgkEmployer,0);
                    const totalCost = p636Payrolls.reduce((s,r)=>s+r.gross+r.sgkEmployer,0);
                    return (
                      <div className="apple-card p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div><h3 className="font-bold text-gray-900 text-sm">💰 {tr636?'SGK/Net Bordro Hesaplama':'SGK/Net Payroll Calculator'}</h3>
                          <p className="text-xs text-gray-400">{tr636?'SGK işçi/işveren payı, gelir vergisi ve net maaş hesabı (2024 dilimleri)':'SGK employee/employer share, income tax and net salary (2024 brackets)'}</p></div>
                          <div className="flex items-center gap-2">
                            <div className="apple-input px-3 py-1.5 text-xs flex items-center gap-1.5"><span className="text-gray-400">{tr636?'Dönem:':'Period:'}</span><input type="month" value={p636Month} onChange={e=>setP636Month(e.target.value)} className="bg-transparent focus:outline-none text-xs" /></div>
                            <button onClick={calcPayroll} className="apple-button-primary text-xs px-4 py-1.5 flex items-center gap-1.5">⚡ {tr636?'Hesapla':'Calculate'}</button>
                          </div>
                        </div>
                        {p636Calculated && p636Payrolls.length > 0 && (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr636?'Brüt Toplam':'Total Gross'}</p><p className="text-lg font-black text-gray-800">₺{totalGross.toLocaleString('tr-TR')}</p></div>
                              <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr636?'Net Toplam':'Total Net'}</p><p className="text-lg font-black text-emerald-600">₺{totalNet.toLocaleString('tr-TR')}</p></div>
                              <div className="bg-orange-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr636?'İşveren SGK':'Employer SGK'}</p><p className="text-lg font-black text-orange-600">₺{totalSgkEmployer.toLocaleString('tr-TR')}</p></div>
                              <div className="bg-red-50 rounded-xl p-3"><p className="text-[10px] font-bold text-gray-400 uppercase">{tr636?'Toplam Maliyet':'Total Cost'}</p><p className="text-lg font-black text-red-600">₺{totalCost.toLocaleString('tr-TR')}</p></div>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead><tr className="border-b border-gray-100 bg-gray-50">
                                  {[tr636?'Çalışan':'Employee',tr636?'Pozisyon':'Position',tr636?'Brüt':'Gross',tr636?'SGK İşçi':'SGK Emp.',tr636?'Gelir Vergisi':'Inc. Tax',tr636?'Damga':'Stamp',tr636?'Net':'Net'].map(h=>(
                                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody className="divide-y divide-gray-50">
                                  {p636Payrolls.map(r=>(
                                    <tr key={r.id} className="hover:bg-gray-50/50">
                                      <td className="px-3 py-2.5 font-semibold text-gray-800">{r.name}</td>
                                      <td className="px-3 py-2.5 text-gray-500">{r.position}</td>
                                      <td className="px-3 py-2.5 font-mono text-gray-700">₺{r.gross.toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2.5 font-mono text-orange-600">₺{r.sgkEmployee.toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2.5 font-mono text-purple-600">₺{r.incomeTax.toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2.5 font-mono text-gray-500">₺{r.stampTax.toLocaleString('tr-TR')}</td>
                                      <td className="px-3 py-2.5 font-bold font-mono text-emerald-600">₺{r.net.toLocaleString('tr-TR')}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <p className="text-[10px] text-gray-400">* {tr636?'SGK işçi: %14, işveren: %20.75; Vergi dilimleri: 0-32K %15, 32-70K %20, 70K+ %27; Damga: %0.759':'SGK emp: 14%, employer: 20.75%; Tax brackets: 0-32K 15%, 32-70K 20%, 70K+ 27%; Stamp: 0.759%'}</p>
                          </>
                        )}
                        {!p636Calculated && <p className="text-center text-gray-400 text-xs py-4">{tr636?`"Hesapla" butonuna tıklayın (${employees.filter(e=>e.status==='Aktif').length} aktif çalışan).`:`Click "Calculate" to compute payroll (${employees.filter(e=>e.status==='Aktif').length} active employees).`}</p>}
                      </div>
                    );
                  })()}
                </>
              )}
            </motion.div>
  );
}
