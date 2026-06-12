import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';
import { FileText, Download, Send, CheckCircle2, AlertCircle, Clock, Plus, X, ChevronDown, ChevronRight, Users, Calculator } from 'lucide-react';

interface MuhtasarModuleProps {
  currentLanguage: string;
  isAuthenticated: boolean;
}

interface Employee {
  id: string;
  name: string;
  tcNo: string;
  sicilNo: string;
  department: string;
  grossSalary: number;
  sgkBase: number;
  employmentType: 'tam' | 'kismi';
  workDays: number; // in the month
  active: boolean;
}

interface SalaryEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  tcNo: string;
  period: string; // YYYY-MM
  grossSalary: number;
  sgkBase: number;
  employeeSgk: number;   // 14% up to ceiling
  employerSgk: number;   // 20.5% up to ceiling
  employeeUnemployment: number; // 1%
  employerUnemployment: number; // 2%
  incomeTax: number;
  stampTax: number;
  netSalary: number;
  workDays: number;
  calculatedAt: any;
}

interface Declaration {
  id: string;
  type: 'muhtasar' | 'sgk';
  period: string;
  status: 'taslak' | 'hazır' | 'gönderildi' | 'onaylandı' | 'red';
  totalTax: number;
  totalSgk: number;
  employeeCount: number;
  gibRefNo?: string;
  submittedAt?: string;
  xmlContent?: string;
  notes: string;
  createdAt: any;
}

// Turkish income tax brackets 2024
const TAX_BRACKETS = [
  { limit: 110000, rate: 0.15 },
  { limit: 230000, rate: 0.20 },
  { limit: 580000, rate: 0.27 },
  { limit: 3000000, rate: 0.35 },
  { limit: Infinity, rate: 0.40 },
];

const SGK_CEILING_MONTHLY = 113662.50; // 2024 SGK üst sınır
const STAMP_TAX_RATE = 0.00759;

function calcIncomeTax(annual: number): number {
  let tax = 0;
  let prev = 0;
  for (const bracket of TAX_BRACKETS) {
    if (annual <= prev) break;
    const slice = Math.min(annual, bracket.limit) - prev;
    tax += slice * bracket.rate;
    prev = bracket.limit;
    if (annual <= bracket.limit) break;
  }
  return tax;
}

function calcSalaryEntry(emp: Employee, period: string): Omit<SalaryEntry, 'id' | 'calculatedAt'> {
  const sgkBase = Math.min(emp.sgkBase, SGK_CEILING_MONTHLY);
  const employeeSgk = sgkBase * 0.14;
  const employerSgk = sgkBase * 0.205;
  const employeeUnemployment = sgkBase * 0.01;
  const employerUnemployment = sgkBase * 0.02;

  // Income tax on annual basis, then monthly portion
  const annualGross = (emp.grossSalary - employeeSgk - employeeUnemployment) * 12;
  const annualTax = calcIncomeTax(annualGross);
  const incomeTax = annualTax / 12;

  const stampTax = emp.grossSalary * STAMP_TAX_RATE;
  const netSalary = emp.grossSalary - employeeSgk - employeeUnemployment - incomeTax - stampTax;

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    tcNo: emp.tcNo,
    period,
    grossSalary: emp.grossSalary,
    sgkBase: emp.sgkBase,
    employeeSgk: Math.round(employeeSgk * 100) / 100,
    employerSgk: Math.round(employerSgk * 100) / 100,
    employeeUnemployment: Math.round(employeeUnemployment * 100) / 100,
    employerUnemployment: Math.round(employerUnemployment * 100) / 100,
    incomeTax: Math.round(incomeTax * 100) / 100,
    stampTax: Math.round(stampTax * 100) / 100,
    netSalary: Math.round(netSalary * 100) / 100,
    workDays: emp.workDays,
  };
}

function fmt(n: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(n);
}

function generateMuhtasarXML(entries: SalaryEntry[], period: string, companyTaxId = '0000000000'): string {
  const [year, month] = period.split('-');
  const totalIncomeTax = entries.reduce((s,e) => s + e.incomeTax, 0);
  const totalStampTax = entries.reduce((s,e) => s + e.stampTax, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Beyanname xsi:noNamespaceSchemaLocation="Muhtasar_PrimHizmet.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Genel>
    <VergiKimlikNo>${companyTaxId}</VergiKimlikNo>
    <DonemYil>${year}</DonemYil>
    <DonemAy>${month}</DonemAy>
    <BeyannameTipi>1</BeyannameTipi>
  </Genel>
  <MuhtasarBeyan>
    <GelirVergisiKesintisi>
      <KodAdi>011</KodAdi>
      <Matrah>${entries.reduce((s,e)=>s+e.grossSalary,0).toFixed(2)}</Matrah>
      <Vergi>${totalIncomeTax.toFixed(2)}</Vergi>
    </GelirVergisiKesintisi>
    <DamgaVergisi>
      <Matrah>${entries.reduce((s,e)=>s+e.grossSalary,0).toFixed(2)}</Matrah>
      <Vergi>${totalStampTax.toFixed(2)}</Vergi>
    </DamgaVergisi>
  </MuhtasarBeyan>
  <HizmetBeyan>
    <Hizmetliler>
${entries.map(e => `      <Hizmetli>
        <TCKimlikNo>${e.tcNo}</TCKimlikNo>
        <Ad>${e.employeeName.split(' ')[0]}</Ad>
        <Soyad>${e.employeeName.split(' ').slice(1).join(' ')}</Soyad>
        <BrutUcret>${e.grossSalary.toFixed(2)}</BrutUcret>
        <GelirVergisiMatrahi>${(e.grossSalary - e.employeeSgk - e.employeeUnemployment).toFixed(2)}</GelirVergisiMatrahi>
        <GelirVergisi>${e.incomeTax.toFixed(2)}</GelirVergisi>
        <DamgaVergisi>${e.stampTax.toFixed(2)}</DamgaVergisi>
        <CalismaSayisi>${e.workDays}</CalismaSayisi>
      </Hizmetli>`).join('\n')}
    </Hizmetliler>
  </HizmetBeyan>
</Beyanname>`;
}

function generateSGKXML(entries: SalaryEntry[], period: string, companyTaxId = '0000000000'): string {
  const [year, month] = period.split('-');
  return `<?xml version="1.0" encoding="UTF-8"?>
<eBildirge xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <IsyeriKodu>${companyTaxId}</IsyeriKodu>
  <Donem>${year}${month}</Donem>
  <Bildirge>
${entries.map(e => `    <Sigortalı>
      <TCKimlikNo>${e.tcNo}</TCKimlikNo>
      <Ad>${e.employeeName}</Ad>
      <PrimGunSayisi>${e.workDays}</PrimGunSayisi>
      <SGKPrimMatrahi>${e.sgkBase.toFixed(2)}</SGKPrimMatrahi>
      <SigortaliHissesi>${e.employeeSgk.toFixed(2)}</SigortaliHissesi>
      <IsverenHissesi>${e.employerSgk.toFixed(2)}</IsverenHissesi>
      <SigortaliIssizlik>${e.employeeUnemployment.toFixed(2)}</SigortaliIssizlik>
      <IsverenIssizlik>${e.employerUnemployment.toFixed(2)}</IsverenIssizlik>
    </Sigortalı>`).join('\n')}
  </Bildirge>
  <ToplamSGKPrimi>${entries.reduce((s,e)=>s+e.employeeSgk+e.employerSgk,0).toFixed(2)}</ToplamSGKPrimi>
  <ToplamIssizlik>${entries.reduce((s,e)=>s+e.employeeUnemployment+e.employerUnemployment,0).toFixed(2)}</ToplamIssizlik>
</eBildirge>`;
}

export default function MuhtasarModule({ currentLanguage, isAuthenticated }: MuhtasarModuleProps) {
  const tr = currentLanguage === 'tr';
  const [view, setView] = useState<'payroll' | 'declarations' | 'employees'>('payroll');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaryEntries, setSalaryEntries] = useState<SalaryEntry[]>([]);
  const [declarations, setDeclarations] = useState<Declaration[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showEmpForm, setShowEmpForm] = useState(false);
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Employee form
  const [eForm, setEForm] = useState({ name:'', tcNo:'', sicilNo:'', department:'', grossSalary:0, sgkBase:0, employmentType:'tam' as Employee['employmentType'], workDays:30 });

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(collection(db, 'employees'), snap => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
      setLoading(false);
    }));
    unsubs.push(onSnapshot(collection(db, 'payrollEntries'), snap => {
      setSalaryEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as SalaryEntry)));
    }));
    unsubs.push(onSnapshot(collection(db, 'taxDeclarations'), snap => {
      setDeclarations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Declaration)));
    }));
    return () => unsubs.forEach(u => u());
  }, []);

  const addEmployee = async () => {
    if (!eForm.name.trim() || !eForm.tcNo.trim()) return;
    const sgkBase = eForm.sgkBase || eForm.grossSalary;
    await addDoc(collection(db, 'employees'), { ...eForm, sgkBase, active: true, createdAt: serverTimestamp() });
    setEForm({ name:'', tcNo:'', sicilNo:'', department:'', grossSalary:0, sgkBase:0, employmentType:'tam', workDays:30 });
    setShowEmpForm(false);
  };

  // Get entries for the selected period
  const periodEntries = useMemo(() => salaryEntries.filter(e => e.period === selectedPeriod), [salaryEntries, selectedPeriod]);

  const generatePayroll = async () => {
    if (employees.length === 0) return;
    setGenerating(true);
    try {
      // Remove old entries for this period
      const existing = salaryEntries.filter(e => e.period === selectedPeriod);
      for (const e of existing) {
        await updateDoc(doc(db, 'payrollEntries', e.id), { deleted: true });
      }
      // Calculate for all active employees
      const activeEmps = employees.filter(e => e.active);
      for (const emp of activeEmps) {
        const entry = calcSalaryEntry(emp, selectedPeriod);
        await addDoc(collection(db, 'payrollEntries'), { ...entry, calculatedAt: serverTimestamp() });
      }
    } finally {
      setGenerating(false);
    }
  };

  const createDeclaration = async (type: Declaration['type']) => {
    const activeEntries = periodEntries.filter(e => !('deleted' in e));
    const xml = type === 'muhtasar'
      ? generateMuhtasarXML(activeEntries, selectedPeriod)
      : generateSGKXML(activeEntries, selectedPeriod);

    await addDoc(collection(db, 'taxDeclarations'), {
      type,
      period: selectedPeriod,
      status: 'hazır',
      totalTax: activeEntries.reduce((s,e) => s + e.incomeTax + e.stampTax, 0),
      totalSgk: activeEntries.reduce((s,e) => s + e.employeeSgk + e.employerSgk + e.employeeUnemployment + e.employerUnemployment, 0),
      employeeCount: activeEntries.length,
      xmlContent: xml,
      notes: '',
      createdAt: serverTimestamp(),
    });
  };

  const updateDeclarationStatus = async (id: string, status: Declaration['status'], gibRefNo?: string) => {
    const upd: any = { status };
    if (gibRefNo) upd.gibRefNo = gibRefNo;
    if (status === 'gönderildi') upd.submittedAt = new Date().toISOString();
    await updateDoc(doc(db, 'taxDeclarations', id), upd);
  };

  const downloadXML = (decl: Declaration) => {
    if (!decl.xmlContent) return;
    const blob = new Blob([decl.xmlContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${decl.type}_${decl.period}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Totals
  const totals = useMemo(() => ({
    gross: periodEntries.reduce((s,e) => s + e.grossSalary, 0),
    net: periodEntries.reduce((s,e) => s + e.netSalary, 0),
    incomeTax: periodEntries.reduce((s,e) => s + e.incomeTax, 0),
    stampTax: periodEntries.reduce((s,e) => s + e.stampTax, 0),
    employeeSgk: periodEntries.reduce((s,e) => s + e.employeeSgk, 0),
    employerSgk: periodEntries.reduce((s,e) => s + e.employerSgk, 0),
    employeeUnemployment: periodEntries.reduce((s,e) => s + e.employeeUnemployment, 0),
    employerUnemployment: periodEntries.reduce((s,e) => s + e.employerUnemployment, 0),
  }), [periodEntries]);

  const totalEmployerCost = totals.gross + totals.employerSgk + totals.employerUnemployment;

  const statusBadge = (status: Declaration['status']) => {
    const map = {
      taslak: 'bg-gray-100 text-gray-600',
      hazır: 'bg-blue-100 text-blue-700',
      gönderildi: 'bg-yellow-100 text-yellow-700',
      onaylandı: 'bg-green-100 text-green-700',
      red: 'bg-red-100 text-red-700',
    };
    return map[status] || 'bg-gray-100 text-gray-600';
  };

  const tabs = [
    { id: 'payroll', label: tr ? 'Bordro' : 'Payroll', icon: Calculator },
    { id: 'declarations', label: tr ? 'Beyannameler' : 'Declarations', icon: FileText },
    { id: 'employees', label: tr ? 'Çalışanlar' : 'Employees', icon: Users },
  ] as const;

  if (!isAuthenticated) return <div className="p-8 text-center text-gray-500">{tr ? 'Lütfen giriş yapın.' : 'Please sign in.'}</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-green-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{tr ? 'Muhtasar & SGK e-Bildirge' : 'Muhtasar & SGK e-Bildirge'}</h1>
            <p className="text-sm text-gray-500">{tr ? 'Bordro, vergi kesintisi ve SGK bildirimi' : 'Payroll, tax withholding and SGK filing'}</p>
          </div>
        </div>
        {view === 'employees' && (
          <button onClick={() => setShowEmpForm(true)}
            className="apple-button-primary text-white px-4 py-2 rounded-full text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> {tr ? 'Çalışan Ekle' : 'Add Employee'}
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

      {/* PAYROLL VIEW */}
      {view === 'payroll' && (
        <div className="space-y-4">
          {/* Period selector + actions */}
          <div className="flex items-center gap-3">
            <input type="month" className="apple-input p-2.5 rounded-xl text-sm" value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value)} />
            <button onClick={generatePayroll} disabled={generating || employees.length === 0}
              className="apple-button-primary text-white px-4 py-2.5 rounded-full text-sm flex items-center gap-2 disabled:opacity-50">
              <Calculator className="w-4 h-4" />
              {generating ? (tr ? 'Hesaplıyor...' : 'Calculating...') : (tr ? 'Bordro Hesapla' : 'Calculate Payroll')}
            </button>
            {periodEntries.length > 0 && (
              <>
                <button onClick={() => createDeclaration('muhtasar')}
                  className="apple-button-secondary px-4 py-2.5 rounded-full text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4" /> {tr ? 'Muhtasar XML' : 'Muhtasar XML'}
                </button>
                <button onClick={() => createDeclaration('sgk')}
                  className="apple-button-secondary px-4 py-2.5 rounded-full text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4" /> {tr ? 'SGK XML' : 'SGK XML'}
                </button>
              </>
            )}
          </div>

          {/* Summary cards */}
          {periodEntries.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: tr ? 'Toplam Brüt' : 'Total Gross', value: totals.gross, color: 'text-gray-900' },
                { label: tr ? 'Toplam Net' : 'Total Net', value: totals.net, color: 'text-blue-600' },
                { label: tr ? 'Gelir Vergisi' : 'Income Tax', value: totals.incomeTax, color: 'text-orange-600' },
                { label: tr ? 'İşveren SGK' : 'Employer SGK', value: totals.employerSgk + totals.employerUnemployment, color: 'text-red-500' },
              ].map((m,i) => (
                <div key={i} className="apple-card p-4">
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <p className={`text-xl font-bold mt-1 ${m.color}`}>{fmt(m.value)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Cost breakdown card */}
          {periodEntries.length > 0 && (
            <div className="apple-card p-4">
              <h3 className="font-semibold text-sm mb-3">{tr ? 'İşveren Maliyet Özeti' : 'Employer Cost Summary'}</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                {[
                  { label: tr ? 'Brüt Maaş' : 'Gross Wages', value: totals.gross },
                  { label: tr ? 'SGK İşveren (%20.5)' : 'SGK Employer (20.5%)', value: totals.employerSgk },
                  { label: tr ? 'İşsizlik İşveren (%2)' : 'Unemp. Employer (2%)', value: totals.employerUnemployment },
                  { label: tr ? 'TOPLAM İŞVEREN MALİYETİ' : 'TOTAL EMPLOYER COST', value: totalEmployerCost, bold: true },
                ].map((r, i) => (
                  <div key={i} className={`p-3 rounded-xl ${r.bold ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <p className="text-gray-500 text-xs">{r.label}</p>
                    <p className={`font-semibold mt-0.5 ${r.bold ? 'text-red-600' : 'text-gray-900'}`}>{fmt(r.value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payroll table */}
          <div className="apple-card overflow-hidden">
            {periodEntries.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Calculator className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>{tr ? 'Bu dönem için bordro hesaplanmadı.' : 'No payroll calculated for this period.'}</p>
                <p className="text-xs mt-1">{tr ? '"Bordro Hesapla" butonuna tıklayın.' : 'Click "Calculate Payroll" to begin.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Çalışan' : 'Employee'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Brüt' : 'Gross'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'SGK İşçi' : 'SGK Empl.'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'İşsizlik İşçi' : 'Unemp Empl.'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Gelir Vergisi' : 'Income Tax'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Damga Vergisi' : 'Stamp Tax'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Net Maaş' : 'Net Salary'}</th>
                      <th className="text-right p-3 font-medium text-gray-600">{tr ? 'SGK İşveren' : 'SGK Empr.'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodEntries.filter(e => !('deleted' in e)).map(e => (
                      <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="p-3">
                          <div>
                            <p className="font-medium">{e.employeeName}</p>
                            <p className="text-xs text-gray-400">{e.tcNo}</p>
                          </div>
                        </td>
                        <td className="p-3 text-right">{fmt(e.grossSalary)}</td>
                        <td className="p-3 text-right text-orange-600">({fmt(e.employeeSgk)})</td>
                        <td className="p-3 text-right text-orange-600">({fmt(e.employeeUnemployment)})</td>
                        <td className="p-3 text-right text-red-600">({fmt(e.incomeTax)})</td>
                        <td className="p-3 text-right text-red-600">({fmt(e.stampTax)})</td>
                        <td className="p-3 text-right font-semibold text-blue-600">{fmt(e.netSalary)}</td>
                        <td className="p-3 text-right text-purple-600">{fmt(e.employerSgk + e.employerUnemployment)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td className="p-3 font-semibold">{tr ? 'TOPLAM' : 'TOTAL'}</td>
                      <td className="p-3 text-right font-semibold">{fmt(totals.gross)}</td>
                      <td className="p-3 text-right font-semibold text-orange-600">({fmt(totals.employeeSgk)})</td>
                      <td className="p-3 text-right font-semibold text-orange-600">({fmt(totals.employeeUnemployment)})</td>
                      <td className="p-3 text-right font-semibold text-red-600">({fmt(totals.incomeTax)})</td>
                      <td className="p-3 text-right font-semibold text-red-600">({fmt(totals.stampTax)})</td>
                      <td className="p-3 text-right font-semibold text-blue-600">{fmt(totals.net)}</td>
                      <td className="p-3 text-right font-semibold text-purple-600">{fmt(totals.employerSgk + totals.employerUnemployment)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DECLARATIONS VIEW */}
      {view === 'declarations' && (
        <div className="space-y-4">
          <div className="apple-card overflow-hidden">
            {declarations.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>{tr ? 'Beyanname bulunamadı.' : 'No declarations found.'}</p>
                <p className="text-xs mt-1">{tr ? 'Bordro sekmesinde XML oluşturun.' : 'Generate XML from the Payroll tab.'}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Dönem' : 'Period'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Tür' : 'Type'}</th>
                    <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Vergi Tutarı' : 'Tax Amount'}</th>
                    <th className="text-right p-3 font-medium text-gray-600">{tr ? 'SGK Tutarı' : 'SGK Amount'}</th>
                    <th className="text-center p-3 font-medium text-gray-600">{tr ? 'Çalışan' : 'Employees'}</th>
                    <th className="text-center p-3 font-medium text-gray-600">{tr ? 'Durum' : 'Status'}</th>
                    <th className="text-right p-3 font-medium text-gray-600">{tr ? 'İşlemler' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {declarations.sort((a,b) => b.period.localeCompare(a.period)).map(d => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="p-3 font-medium">{d.period}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.type === 'muhtasar' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
                          {d.type === 'muhtasar' ? 'Muhtasar & PHB' : 'SGK e-Bildirge'}
                        </span>
                      </td>
                      <td className="p-3 text-right">{fmt(d.totalTax)}</td>
                      <td className="p-3 text-right">{fmt(d.totalSgk)}</td>
                      <td className="p-3 text-center">{d.employeeCount}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(d.status)}`}>
                          {d.status === 'taslak' ? (tr ? 'Taslak' : 'Draft') :
                           d.status === 'hazır' ? (tr ? 'Hazır' : 'Ready') :
                           d.status === 'gönderildi' ? (tr ? 'Gönderildi' : 'Submitted') :
                           d.status === 'onaylandı' ? (tr ? 'Onaylandı' : 'Approved') : (tr ? 'Reddedildi' : 'Rejected')}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-2">
                          {d.xmlContent && (
                            <button onClick={() => downloadXML(d)}
                              className="p-1.5 rounded-lg hover:bg-gray-100" title={tr ? 'XML İndir' : 'Download XML'}>
                              <Download className="w-4 h-4 text-gray-500" />
                            </button>
                          )}
                          {d.status === 'hazır' && (
                            <button onClick={() => updateDeclarationStatus(d.id, 'gönderildi')}
                              className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs hover:bg-blue-100">
                              {tr ? 'Gönder' : 'Submit'}
                            </button>
                          )}
                          {d.status === 'gönderildi' && (
                            <button onClick={() => updateDeclarationStatus(d.id, 'onaylandı')}
                              className="px-2 py-1 rounded-lg bg-green-50 text-green-700 text-xs hover:bg-green-100">
                              {tr ? 'Onayla' : 'Approve'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* EMPLOYEES VIEW */}
      {view === 'employees' && (
        <div className="space-y-4">
          <div className="apple-card overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-400">{tr ? 'Yükleniyor...' : 'Loading...'}</div>
            ) : employees.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>{tr ? 'Çalışan bulunamadı.' : 'No employees found.'}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Çalışan' : 'Employee'}</th>
                    <th className="text-left p-3 font-medium text-gray-600">TC No</th>
                    <th className="text-left p-3 font-medium text-gray-600">{tr ? 'Departman' : 'Department'}</th>
                    <th className="text-right p-3 font-medium text-gray-600">{tr ? 'Brüt Maaş' : 'Gross'}</th>
                    <th className="text-right p-3 font-medium text-gray-600">{tr ? 'SGK Matrahı' : 'SGK Base'}</th>
                    <th className="text-center p-3 font-medium text-gray-600">{tr ? 'Çalışma Günü' : 'Work Days'}</th>
                    <th className="text-center p-3 font-medium text-gray-600">{tr ? 'Tür' : 'Type'}</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(e => (
                    <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="p-3 font-medium">{e.name}</td>
                      <td className="p-3 text-gray-500 font-mono text-xs">{e.tcNo}</td>
                      <td className="p-3 text-gray-600">{e.department || '-'}</td>
                      <td className="p-3 text-right">{fmt(e.grossSalary)}</td>
                      <td className="p-3 text-right">{fmt(e.sgkBase || e.grossSalary)}</td>
                      <td className="p-3 text-center">{e.workDays}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${e.employmentType === 'tam' ? 'bg-blue-50 text-blue-700' : 'bg-yellow-50 text-yellow-700'}`}>
                          {e.employmentType === 'tam' ? (tr ? 'Tam Zamanlı' : 'Full-time') : (tr ? 'Kısmi' : 'Part-time')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* EMPLOYEE FORM MODAL */}
      {showEmpForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tr ? 'Yeni Çalışan' : 'New Employee'}</h2>
              <button onClick={() => setShowEmpForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input className="apple-input col-span-2 p-3 rounded-xl text-sm" placeholder={tr ? 'Ad Soyad *' : 'Full Name *'} value={eForm.name} onChange={e=>setEForm(p=>({...p,name:e.target.value}))} />
              <input className="apple-input p-3 rounded-xl text-sm font-mono" placeholder="TC Kimlik No *" value={eForm.tcNo} onChange={e=>setEForm(p=>({...p,tcNo:e.target.value}))} maxLength={11} />
              <input className="apple-input p-3 rounded-xl text-sm" placeholder={tr ? 'Sicil No' : 'Employee ID'} value={eForm.sicilNo} onChange={e=>setEForm(p=>({...p,sicilNo:e.target.value}))} />
              <input className="apple-input p-3 rounded-xl text-sm" placeholder={tr ? 'Departman' : 'Department'} value={eForm.department} onChange={e=>setEForm(p=>({...p,department:e.target.value}))} />
              <select className="apple-input p-3 rounded-xl text-sm" value={eForm.employmentType} onChange={e=>setEForm(p=>({...p,employmentType:e.target.value as Employee['employmentType']}))}>
                <option value="tam">{tr ? 'Tam Zamanlı' : 'Full-time'}</option>
                <option value="kismi">{tr ? 'Kısmi Zamanlı' : 'Part-time'}</option>
              </select>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Brüt Maaş (TL)' : 'Gross Salary (TL)'}</label>
                <input type="number" className="apple-input w-full p-3 rounded-xl text-sm" value={eForm.grossSalary || ''} onChange={e=>setEForm(p=>({...p,grossSalary:Number(e.target.value)}))} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'SGK Matrahı (boş = brüt)' : 'SGK Base (empty = gross)'}</label>
                <input type="number" className="apple-input w-full p-3 rounded-xl text-sm" value={eForm.sgkBase || ''} onChange={e=>setEForm(p=>({...p,sgkBase:Number(e.target.value)}))} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{tr ? 'Prim Günü' : 'Work Days'}</label>
                <input type="number" min="1" max="31" className="apple-input w-full p-3 rounded-xl text-sm" value={eForm.workDays} onChange={e=>setEForm(p=>({...p,workDays:Number(e.target.value)}))} />
              </div>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
              <p className="font-medium mb-1">{tr ? 'Otomatik hesaplanan kesintiler:' : 'Auto-calculated deductions:'}</p>
              <p>SGK İşçi: %14 | SGK İşveren: %20.5 | İşsizlik İşçi: %1 | İşveren: %2 | Damga: %0.759</p>
              <p className="mt-1">{tr ? 'SGK tavan: ' : 'SGK ceiling: '}{fmt(SGK_CEILING_MONTHLY)}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowEmpForm(false)} className="apple-button-secondary flex-1 p-3 rounded-full text-sm">{tr ? 'İptal' : 'Cancel'}</button>
              <button onClick={addEmployee} className="apple-button-primary text-white flex-1 p-3 rounded-full text-sm">{tr ? 'Kaydet' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
