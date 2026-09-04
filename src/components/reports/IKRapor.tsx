/**
 * IKRapor.tsx — Raporlar > İnsan Kaynakları sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'ik' sekmesine ait 38 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'ik'` koşulları BİLEREK korundu: ebeveyn zaten
 * sekmeye göre render ediyor, ama koşulu silmek binlerce satırda metin
 * dönüşümü demekti ve bu taşımanın "saf kopya" güvencesini bozardı.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import {
  LayoutDashboard, List, Truck, UserCheck, Package, Users, BarChart3,
  AlertCircle, Calendar, Download, CheckCircle2,
  CreditCard,
} from 'lucide-react';
import { format } from 'date-fns';
import { tr, enUS } from 'date-fns/locale';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  collection, onSnapshot, query, where,
} from '../../lib/dbClient';
import { db, auth } from '../../firebase';
import { logFirestoreError as importedLogFirestoreError, OperationType } from '../../utils/firebase';
import { sortByCreatedAt } from '../../utils/fsSort';
import { formatInCurrency } from '../../utils/currency';
import ModuleHeader from '../ModuleHeader';
import {
  type Order,
  type Employee,
  type Quotation,
  type InventoryItem,
  type InventoryMovement,
} from '../../types';
import { itemCostTRY, itemPriceTRY, type ReportsCtx, brutMarj } from './useReportsData';
import { KpiCard, KpiGrid, KpiCurrencyToggle } from './ReportKit';

export default function IKRapor(ctx: ReportsCtx) {
  const { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, salesByDate, trendData, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF } = ctx;
  void itemCostTRY; void itemPriceTRY; // sekmeye göre kullanılıyor olabilir
  return (
    <>
      {reportsTab === 'ik' && (
        <div className="space-y-6">
          {/* KPIs — ortak KpiCard/KpiGrid (ReportKit) ile tek tip */}
          <KpiGrid cols={3}>
            {([
              { label: currentLanguage==='tr'?'Aktif Çalışan':'Active Employees', value: hrStats.activeEmployees.toString(), icon: Users, accent: 'text-blue-600', accentBg: 'bg-blue-50', desc: currentLanguage==='tr'?'Toplam çalışan sayısı':'Total employee count', isMoney: false },
              { label: currentLanguage==='tr'?'Ödenen Maaş':'Paid Salary', value: formatInCurrency(hrStats.totalPayroll, revenueCurrency, exchangeRates ?? undefined), icon: CreditCard, accent: 'text-green-600', accentBg: 'bg-green-50', desc: currentLanguage==='tr'?'Toplam ödenen bordro':'Total paid payroll', isMoney: true },
              { label: currentLanguage==='tr'?'İzin Bekleyen':'Pending Leave', value: hrStats.pendingLeave.toString(), icon: Calendar, accent: 'text-orange-500', accentBg: 'bg-orange-50', desc: currentLanguage==='tr'?'Onay bekleyen talepler':'Requests awaiting approval', isMoney: false },
            ] as { label: string; value: string; icon: React.ElementType; accent: string; accentBg: string; desc: string; isMoney: boolean }[]).map((k,i) => (
              <KpiCard key={i} index={i} label={k.label} value={k.value} icon={k.icon} accent={k.accent} accentBg={k.accentBg} hint={k.desc}
                action={k.isMoney ? <KpiCurrencyToggle value={revenueCurrency} onChange={setRevenueCurrency} /> : undefined} />
            ))}
          </KpiGrid>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="apple-card p-6">
              <h4 className="font-bold mb-6">{currentLanguage==='tr'?'Departman Dağılımı':'Department Distribution'}</h4>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={hrStats.departmentDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {hrStats.departmentDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="apple-card p-6">
              <h4 className="font-bold mb-6">{currentLanguage==='tr'?'Maaş Ödeme Trendi':'Payroll Payment Trend'}</h4>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hrStats.payrollTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#ff4000" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Phase 180: HR Cost Ratio ── */}
      {reportsTab === 'ik' && employees.length > 0 && orders.length > 0 && (() => {
        const totalRevHR = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const totalPayrollHR = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
        const hrCostRatio = totalRevHR > 0 ? Math.round((totalPayrollHR / totalRevHR) * 100) : 0;
        const revenuePerPayroll = totalPayrollHR > 0 ? (totalRevHR / totalPayrollHR).toFixed(1) : '—';
        const totalOrders180 = orders.filter(o => o.status !== 'Cancelled').length;
        const avgOrdersPerEmp = employees.filter(e => e.status === 'Aktif').length > 0
          ? Math.round(totalOrders180 / employees.filter(e => e.status === 'Aktif').length)
          : 0;
        return (
          <div className="apple-card p-6">
            <h4 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'💼 İK Maliyet Analizi':'💼 HR Cost Analysis'}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: currentLanguage==='tr'?'İK / Ciro Oranı':'HR Cost Ratio', value: `%${hrCostRatio}`, color: hrCostRatio <= 20 ? 'text-emerald-600' : hrCostRatio <= 40 ? 'text-amber-600' : 'text-red-500', desc: currentLanguage==='tr'?'Maaş/Toplam Ciro':'Payroll/Revenue' },
                { label: currentLanguage==='tr'?'Gelir Çarpanı':'Revenue Multiplier', value: `${revenuePerPayroll}x`, color: 'text-blue-600', desc: currentLanguage==='tr'?'Ciro/Maaş Kütlesi':'Revenue/Payroll' },
                { label: currentLanguage==='tr'?'Toplam Maaş':'Total Payroll', value: `₺${(totalPayrollHR/1000).toFixed(0)}K`, color: 'text-gray-700', desc: currentLanguage==='tr'?'Aylık':'Monthly' },
                { label: currentLanguage==='tr'?'Çalışan Başı Sipariş':'Orders/Employee', value: String(avgOrdersPerEmp), color: 'text-purple-600', desc: currentLanguage==='tr'?'Toplam sipariş/aktif':'Total orders/active' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-gray-600">{currentLanguage==='tr'?'İK Maliyeti / Toplam Ciro':'HR Cost / Revenue'}</span>
                <span className={`text-xs font-bold ${hrCostRatio <= 20 ? 'text-emerald-600' : hrCostRatio <= 40 ? 'text-amber-600' : 'text-red-500'}`}>%{hrCostRatio}</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${hrCostRatio <= 20 ? 'bg-emerald-400' : hrCostRatio <= 40 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.min(hrCostRatio, 100)}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{currentLanguage==='tr'?'Benchmark: %20-35 (B2B SaaS sektörü)':'Benchmark: 20-35% (B2B sector)'}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 188: Headcount Planning ── */}
      {reportsTab === 'ik' && employees.length > 0 && orders.length > 0 && (() => {
        const activeEmps188 = employees.filter(e => e.status === 'Aktif').length || 1;
        const totalRev188 = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const revPerEmp188 = Math.round(totalRev188 / activeEmps188);
        // Estimate headcount needed for 1.5x and 2x revenue targets
        const targets188 = [
          { label: currentLanguage === 'tr' ? '1.5× Büyüme' : '1.5× Growth', rev: totalRev188 * 1.5 },
          { label: currentLanguage === 'tr' ? '2× Büyüme' : '2× Growth', rev: totalRev188 * 2 },
          { label: currentLanguage === 'tr' ? '3× Büyüme' : '3× Growth', rev: totalRev188 * 3 },
        ].map(t => ({
          ...t,
          headcount: revPerEmp188 > 0 ? Math.ceil(t.rev / revPerEmp188) : 0,
          hires: revPerEmp188 > 0 ? Math.max(0, Math.ceil(t.rev / revPerEmp188) - activeEmps188) : 0,
        }));
        // PAY ve PAYDA AYNI KUMEDEN (2026-09-04 denetimi): pay yalniz maasi GIRILI
        // calisanlari topluyordu, payda ise TUM aktif calisanlardi — maasi girilmemis
        // her calisan ortalamayi asagi cekiyordu. Maasi bilinmeyen calisan ortalamaya
        // hic girmez; hicbirinin maasi yoksa ortalama BILINMIYOR ('—'), 0 degil.
        const maasliCalisanlar = employees.filter(e => e.status === 'Aktif' && e.salary);
        const avgSalary188: number | null = maasliCalisanlar.length > 0
          ? maasliCalisanlar.reduce((s, e) => s + (e.salary || 0), 0) / maasliCalisanlar.length
          : null;
        const maassizSayi188 = activeEmps188 - maasliCalisanlar.length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '👷 Kadro Planlama' : '👷 Headcount Planning'}</h3>
              <span className="text-xs text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `${activeEmps188} aktif` : `${activeEmps188} active`}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Çalışan Başı Ciro' : 'Revenue / Employee'}</p>
                <p className="text-2xl font-black text-gray-800">{fmtAna(revPerEmp188,'K',0)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Ort. Maaş' : 'Avg Salary'}</p>
                <p className="text-2xl font-black text-gray-800">{avgSalary188 === null ? '—' : fmtAna(avgSalary188,'K',0)}</p>
                {maassizSayi188 > 0 && (
                  <p className="text-[9px] text-amber-600 mt-0.5">
                    {currentLanguage === 'tr'
                      ? `${maassizSayi188} çalışanın maaşı girilmemiş — ortalamaya dahil değil`
                      : `${maassizSayi188} without salary — excluded`}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-700">{currentLanguage === 'tr' ? 'Büyüme Senaryoları:' : 'Growth Scenarios:'}</p>
              {targets188.map(t => (
                <div key={t.label} className="flex items-center justify-between p-3 bg-purple-50 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-purple-800">{t.label}</p>
                    <p className="text-[10px] text-purple-600">{fmtAna(t.rev,'K',0)} {currentLanguage === 'tr' ? 'hedef ciro' : 'target revenue'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-purple-700">{t.headcount} {currentLanguage === 'tr' ? 'kişi' : 'staff'}</p>
                    <p className="text-[10px] text-purple-500">+{t.hires} {currentLanguage === 'tr' ? 'yeni işe alım' : 'new hires'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 154: HR Turnover & Tenure Analytics ── */}
          {employees.length > 0 && (() => {
            const now154 = new Date();
            const active = employees.filter(e => e.status === 'Aktif');
            const left = employees.filter(e => e.status === 'Ayrıldı');
            const turnoverRate = employees.length > 0 ? Math.round((left.length / employees.length) * 100) : 0;
            // Tenure buckets for active employees
            const tenureBuckets = [
              { label: currentLanguage==='tr'?'<1 Yıl':'<1 Year', min: 0, max: 12, count: 0 },
              { label: currentLanguage==='tr'?'1-3 Yıl':'1-3 Yrs', min: 12, max: 36, count: 0 },
              { label: currentLanguage==='tr'?'3-5 Yıl':'3-5 Yrs', min: 36, max: 60, count: 0 },
              { label: currentLanguage==='tr'?'5+ Yıl':'5+ Yrs', min: 60, max: Infinity, count: 0 },
            ];
            for (const e of active) {
              if (!e.startDate) continue;
              const months = Math.round((now154.getTime() - new Date(e.startDate).getTime()) / (30 * 86400000));
              const b = tenureBuckets.find(b => months >= b.min && months < b.max);
              if (b) b.count++;
            }
            const maxBucket = Math.max(...tenureBuckets.map(b => b.count), 1);
            // Avg tenure
            const avgTenureMonths = active.filter(e => e.startDate).length > 0
              ? Math.round(active.filter(e => e.startDate).reduce((s, e) => s + Math.round((now154.getTime() - new Date(e.startDate!).getTime()) / (30 * 86400000)), 0) / active.filter(e => e.startDate).length)
              : 0;
            // Salary by dept
            const deptSalary: Record<string, number> = {};
            for (const e of active) {
              if (!e.department || !e.salary) continue;
              deptSalary[e.department] = (deptSalary[e.department] ?? 0) + (e.salary || 0);
            }
            const deptList = Object.entries(deptSalary).sort(([,a],[,b]) => b - a).slice(0, 5);
            const maxDeptSal = Math.max(...deptList.map(([,v]) => v), 1);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="apple-card p-6">
                  <h4 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'👥 Kıdem Dağılımı':'👥 Tenure Distribution'}</h4>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { label: currentLanguage==='tr'?'Aktif':'Active', value: active.length, color: 'text-emerald-600' },
                      { label: currentLanguage==='tr'?'Ortalama Kıdem':'Avg Tenure', value: `${Math.floor(avgTenureMonths/12)}y ${avgTenureMonths%12}m`, color: 'text-blue-600' },
                      { label: currentLanguage==='tr'?'Ayrılan':'Left', value: left.length, color: 'text-red-500' },
                      { label: currentLanguage==='tr'?'Devir Oranı':'Turnover', value: `%${turnoverRate}`, color: turnoverRate <= 15 ? 'text-emerald-600' : 'text-red-500' },
                    ].map(k => (
                      <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                        <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                        <p className="text-[10px] text-gray-400">{k.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {tenureBuckets.map(b => (
                      <div key={b.label} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-16 shrink-0">{b.label}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((b.count / maxBucket) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 w-6 text-right">{b.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="apple-card p-6">
                  <h4 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'💰 Departman Maaş Kütlesi':'💰 Payroll by Department'}</h4>
                  {deptList.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">{currentLanguage==='tr'?'Veri yok':'No data'}</p>
                  ) : (
                    <div className="space-y-3">
                      {deptList.map(([dept, total]) => (
                        <div key={dept}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-800 truncate">{dept}</span>
                            <span className="text-xs font-bold text-gray-700 tabular-nums ml-2 shrink-0">{fmtAna(total)}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.round((total / maxDeptSal) * 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="apple-card p-6 text-center">
            <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <UserCheck className="w-8 h-8 text-purple-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">{currentLanguage==='tr'?'İK Yönetimine Git':'Go to HR Management'}</h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">{currentLanguage==='tr'?'Detaylı çalışan yönetimi, bordro hesaplama ve izin onayları için İK sekmesini kullanın.':'Use the HR tab for detailed employee management, payroll calculation, and leave approvals.'}</p>
            <button onClick={() => onNavigate?.('ik')} className="apple-button-primary px-6 py-2 text-sm">
              {currentLanguage==='tr'?'İnsan Kaynakları Sekmesine Git →':'Go to Human Resources →'}
            </button>
          </div>

          {/* ── Phase 169: Revenue per Employee ── */}
          {employees.length > 0 && orders.length > 0 && (() => {
            const activeEmps = employees.filter(e => e.status === 'Aktif').length || 1;
            const totalRev169 = orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0);
            const revPerEmp = Math.round(totalRev169 / activeEmps);
            const totalPayroll = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
            const revenueMultiplier = totalPayroll > 0 ? (totalRev169 / totalPayroll).toFixed(1) : '—';
            // Revenue per dept
            const deptRevMap: Record<string, number> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              const rep = (o.assignedTo as string | undefined) || '';
              const emp = employees.find(e => e.name === rep || e.email === rep);
              if (emp?.department) {
                deptRevMap[emp.department] = (deptRevMap[emp.department] ?? 0) + (o.totalPrice || 0);
              }
            }
            const deptList169 = Object.entries(deptRevMap).sort(([,a],[,b]) => b - a).slice(0, 5);
            return (
              <div className="apple-card p-6">
                <h4 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'📊 Çalışan Başı Üretkenlik':'📊 Revenue per Employee'}</h4>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: currentLanguage==='tr'?'Çalışan Başı Ciro':'Rev / Employee', value: `₺${(revPerEmp/1000).toFixed(1)}K`, color: 'text-blue-600' },
                    { label: currentLanguage==='tr'?'Gelir Çarpanı':'Revenue Multiplier', value: `${revenueMultiplier}x`, color: 'text-emerald-600' },
                    { label: currentLanguage==='tr'?'Aktif Çalışan':'Active Staff', value: String(activeEmps), color: 'text-gray-700' },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                      <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{k.label}</p>
                    </div>
                  ))}
                </div>
                {deptList169.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage==='tr'?'Departman Bazlı Ciro':'Revenue by Department'}</p>
                    {deptList169.map(([dept, rev]) => (
                      <div key={dept} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700 truncate">{dept}</span>
                        <span className="font-bold text-gray-800 ml-2">{fmtAna(rev,'K',1)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {reportsTab === 'ik' && employees.length > 0 && orders.length >= 3 && (() => {
        const now208 = new Date();
        const months208 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now208.getFullYear(), now208.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          const payroll = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
          return { label, rev, payroll, ratio: rev > 0 ? Math.round((payroll / rev) * 100) : 0 };
        });
        const maxRev208 = Math.max(...months208.map(m => m.rev), 1);
        const maxPayroll208 = Math.max(...months208.map(m => m.payroll), 1);
        const maxVal208 = Math.max(maxRev208, maxPayroll208);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💰 Maaş Kütlesi vs Ciro Köprüsü' : '💰 Payroll vs Revenue Bridge'}</h3>
            <div className="flex items-end gap-3 h-28 mb-2">
              {months208.map((m, i) => {
                const revH = Math.round((m.rev / maxVal208) * 80);
                const payH = Math.round((m.payroll / maxVal208) * 80);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end gap-0.5" style={{ height: '80px' }}>
                      <div className="flex-1 bg-blue-400 rounded-t-sm" style={{ height: `${Math.max(2, revH)}px` }} title={`Rev ₺${(m.rev/1000).toFixed(0)}K`} />
                      <div className="flex-1 bg-red-300 rounded-t-sm" style={{ height: `${Math.max(2, payH)}px` }} title={`Payroll ₺${(m.payroll/1000).toFixed(0)}K`} />
                    </div>
                    <span className="text-[9px] text-gray-400 leading-none">{m.label}</span>
                    {m.ratio > 0 && <span className={`text-[8px] font-bold ${m.ratio <= 30 ? 'text-emerald-500' : m.ratio <= 50 ? 'text-amber-500' : 'text-red-500'}`}>%{m.ratio}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" />{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300 inline-block" />{currentLanguage === 'tr' ? 'Maaş' : 'Payroll'}</span>
              <span className="ml-auto">{currentLanguage === 'tr' ? '%: Maaş/Ciro' : '%: Payroll/Revenue'}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length > 0 && orders.length >= 3 && (() => {
        const empRevMap: Record<string, { name: string; rev: number; orders: number; dept: string }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const rep = (o.assignedTo as string | undefined) || (o as unknown as Record<string,unknown>).salesRep as string || '';
          if (!rep) continue;
          const emp = employees.find(e => e.name === rep || e.email === rep);
          const name = emp?.name ?? rep;
          const dept = emp?.department ?? (currentLanguage === 'tr' ? 'Satış' : 'Sales');
          if (!empRevMap[name]) empRevMap[name] = { name, rev: 0, orders: 0, dept };
          empRevMap[name].rev += o.totalPrice || 0;
          empRevMap[name].orders++;
        }
        const empList = Object.values(empRevMap).sort((a, b) => b.rev - a.rev).slice(0, 8);
        if (empList.length < 2) return null;
        const totalEmpRev = empList.reduce((s, e) => s + e.rev, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '👤 Çalışan Satış Atıf Analizi' : '👤 Employee Sales Attribution'}</h3>
            <div className="space-y-2.5">
              {empList.map(e => {
                const pct = totalEmpRev > 0 ? Math.round((e.rev / totalEmpRev) * 100) : 0;
                return (
                  <div key={e.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div>
                        <span className="text-xs font-medium text-gray-800">{e.name}</span>
                        <span className="text-[10px] text-gray-400 ml-1.5">{e.dept}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{e.orders} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                        <span className="text-[10px] font-bold text-gray-500">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(e.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length > 0 && (() => {
        // Use employee records to find certification/training fields
        type EmpRec = Record<string, unknown>;
        const withCerts = employees.filter(e => {
          const m = e as unknown as EmpRec;
          return !!(m.certifications || m.training || m.skills);
        });
        const deptDist: Record<string, { trained: number; total: number }> = {};
        for (const e of employees) {
          if (e.status !== 'Aktif') continue;
          const dept = e.department || (currentLanguage === 'tr' ? 'Genel' : 'General');
          if (!deptDist[dept]) deptDist[dept] = { trained: 0, total: 0 };
          deptDist[dept].total++;
          const m = e as unknown as EmpRec;
          if (m.certifications || m.training || m.skills) deptDist[dept].trained++;
        }
        const activeCount = employees.filter(e => e.status === 'Aktif').length;
        const trainedCount = withCerts.filter(e => e.status === 'Aktif').length;
        const coveragePct = activeCount > 0 ? Math.round((trainedCount / activeCount) * 100) : 0;
        const deptList = Object.entries(deptDist).filter(([,d]) => d.total > 0).sort(([,a],[,b]) => b.total - a.total).slice(0, 5);
        if (deptList.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🎓 Eğitim & Sertifika Takibi' : '🎓 Training & Certification Tracker'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${coveragePct >= 70 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                %{coveragePct} {currentLanguage === 'tr' ? 'kapsam' : 'coverage'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Aktif Çalışan' : 'Active Employees', value: activeCount, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? 'Sertifikalı' : 'Certified/Trained', value: trainedCount, color: 'text-emerald-600' },
                { label: currentLanguage === 'tr' ? 'Eksik Kayıt' : 'Missing Records', value: activeCount - trainedCount, color: 'text-amber-600' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {deptList.map(([dept, d]) => {
                const pct = d.total > 0 ? Math.round((d.trained / d.total) * 100) : 0;
                return (
                  <div key={dept}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700">{dept}</span>
                      <span className="text-xs text-gray-400 shrink-0 ml-2">{d.trained}/{d.total} · %{pct}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length > 0 && orders.length >= 3 && (() => {
        const now233 = new Date();
        const months233 = 3;
        const cutoff233 = new Date(now233.getFullYear(), now233.getMonth() - months233, 1);
        const recentRev = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= cutoff233;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const activeEmps233 = employees.filter(e => e.status === 'Aktif');
        const totalPayroll233 = activeEmps233.reduce((s, e) => s + (e.salary || 0), 0) * months233;
        const efficiency = totalPayroll233 > 0 ? Math.round((recentRev / totalPayroll233) * 100) / 100 : 0;
        // By department
        const deptEff: Record<string, { rev: number; payroll: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const rep = (o.assignedTo as string | undefined) || '';
          if (!rep) continue;
          const emp = activeEmps233.find(e => e.name === rep || e.email === rep);
          if (!emp?.department) continue;
          const dept = emp.department;
          if (!deptEff[dept]) deptEff[dept] = { rev: 0, payroll: 0 };
          deptEff[dept].rev += o.totalPrice || 0;
        }
        for (const e of activeEmps233) {
          if (!e.department) continue;
          if (!deptEff[e.department]) deptEff[e.department] = { rev: 0, payroll: 0 };
          deptEff[e.department].payroll += (e.salary || 0) * months233;
        }
        const deptList233 = Object.entries(deptEff)
          .filter(([,d]) => d.payroll > 0)
          .map(([dept, d]) => ({ dept, eff: d.payroll > 0 ? Math.round((d.rev / d.payroll) * 100) / 100 : 0, rev: d.rev, payroll: d.payroll }))
          .sort((a, b) => b.eff - a.eff)
          .slice(0, 5);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Personel Verimlilik Skoru' : '⚡ Payroll Efficiency Score'}</h3>
              <span className={`text-2xl font-black ${efficiency >= 3 ? 'text-emerald-600' : efficiency >= 1.5 ? 'text-amber-500' : 'text-red-500'}`}>{efficiency}×</span>
            </div>
            <p className="text-[11px] text-gray-500 mb-4">{currentLanguage === 'tr' ? `Son ${months233} ayda ₺${(recentRev/1000).toFixed(0)}K ciro / ₺${(totalPayroll233/1000).toFixed(0)}K maaş kütlesi` : `Last ${months233} months: ₺${(recentRev/1000).toFixed(0)}K revenue / ₺${(totalPayroll233/1000).toFixed(0)}K payroll`}</p>
            {deptList233.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 mb-1">{currentLanguage === 'tr' ? 'Departmana Göre:' : 'By Department:'}</p>
                {deptList233.map(d => (
                  <div key={d.dept} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 truncate">{d.dept}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${d.eff >= 3 ? 'bg-emerald-400' : d.eff >= 1.5 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${Math.min(100, Math.round(d.eff * 20))}%` }} />
                      </div>
                      <span className={`font-bold w-10 text-right ${d.eff >= 3 ? 'text-emerald-600' : d.eff >= 1.5 ? 'text-amber-600' : 'text-red-500'}`}>{d.eff}×</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Benchmark: 3x+ mükemmel, 2-3x iyi, 1.5-2x orta, <1.5x geliştirme gerekiyor' : 'Benchmark: 3x+ excellent, 2-3x good, 1.5-2x fair, <1.5x needs improvement'}</p>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length > 0 && (() => {
        type EmpWithHR = { overtimeHours?: number; absenceDays?: number; leaveDays?: number; status?: string; name?: string; department?: string };
        const active248 = employees.filter(e => e.status === 'Aktif') as unknown as EmpWithHR[];
        const withOvertime = active248.filter(e => (e.overtimeHours ?? 0) > 0);
        const withAbsence = active248.filter(e => ((e.absenceDays ?? 0) + (e.leaveDays ?? 0)) > 0);
        const avgOvertime = active248.length > 0
          ? Math.round(active248.reduce((s, e) => s + (e.overtimeHours ?? 0), 0) / active248.length * 10) / 10
          : 0;
        const avgAbsence = active248.length > 0
          ? Math.round(active248.reduce((s, e) => s + (e.absenceDays ?? 0) + (e.leaveDays ?? 0), 0) / active248.length * 10) / 10
          : 0;
        if (avgOvertime === 0 && avgAbsence === 0) return null;
        const topOT = [...active248].sort((a, b) => (b.overtimeHours ?? 0) - (a.overtimeHours ?? 0)).slice(0, 4);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '⏰ Fazla Mesai & Devamsızlık Oranı' : '⏰ Overtime & Absence Rate'}</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Ort. Fazla Mesai' : 'Avg Overtime', value: `${avgOvertime}h`, count: withOvertime.length, color: 'text-amber-600' },
                { label: currentLanguage === 'tr' ? 'Ort. Devamsızlık' : 'Avg Absence', value: `${avgAbsence}d`, count: withAbsence.length, color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.count} {currentLanguage === 'tr' ? 'çalışan' : 'employees'}</p>
                </div>
              ))}
            </div>
            {topOT.some(e => (e.overtimeHours ?? 0) > 0) && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage === 'tr' ? 'En Çok Fazla Mesai:' : 'Top Overtime Workers:'}</p>
                <div className="space-y-1.5">
                  {topOT.filter(e => (e.overtimeHours ?? 0) > 0).map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{e.name ?? '—'}</span>
                      <span className="font-bold text-amber-600 shrink-0 ml-2">{e.overtimeHours}h</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length > 0 && orders.length >= 3 && inventory.length > 0 && (() => {
        const activeEmps253 = employees.filter(e => e.status === 'Aktif').length || 1;
        // Ortak brutMarj (2026-09-04): kalem verisi olmayan siparisler kapsam disi;
        // aksi halde brut kar = ciro sayilip calisan basi katma deger sisiyordu.
        const marj253 = brutMarj(orders.filter(o => o.status !== 'Cancelled'), inventory, exchangeRates);
        const totalGross253 = marj253.ciro - marj253.maliyet;
        const grossPerEmp = Math.round(totalGross253 / activeEmps253);
        const revPerEmp253 = Math.round(orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (o.totalPrice || 0), 0) / activeEmps253);
        const totalPayroll253 = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + (e.salary || 0), 0);
        const grossToPayroll = totalPayroll253 > 0 ? Math.round((totalGross253 / totalPayroll253) * 10) / 10 : 0;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💹 Çalışan Başı Brüt Kâr' : '💹 Gross Margin per Employee'}</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Çalışan Başı Brüt Kâr' : 'Gross Profit / Employee'}</p>
                <p className="text-3xl font-black text-emerald-700">{fmtAna(grossPerEmp,'K',0)}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Çalışan Başı Ciro' : 'Revenue / Employee'}</p>
                <p className="text-3xl font-black text-blue-700">{fmtAna(revPerEmp253,'K',0)}</p>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl flex items-center justify-between">
              <span className="text-xs text-gray-600">{currentLanguage === 'tr' ? 'Brüt Kâr / Maaş Kütlesi' : 'Gross Profit / Payroll'}</span>
              <span className={`text-lg font-black ${grossToPayroll >= 2 ? 'text-emerald-600' : grossToPayroll >= 1 ? 'text-amber-500' : 'text-red-500'}`}>{grossToPayroll}×</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Benchmark: 2x+ iyi (maaş kütlesi başına 2x brüt kâr)' : 'Benchmark: 2x+ healthy (2x gross profit per payroll dollar)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const totalPayroll = employees.reduce((s,e) => s + (e.salary || 0), 0);
        const data = months.map(m => {
          const rev = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          }).reduce((s,o) => s+o.totalPrice, 0);
          return { label: m.label, revenue: rev, payroll: totalPayroll, ratio: rev > 0 ? (totalPayroll/rev*100) : 0 };
        });
        const hasData = data.some(d => d.revenue > 0);
        if (!hasData) return null;
        const maxRev = Math.max(...data.map(d=>d.revenue),1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Bordro/Ciro Oranı Eğilimi' : 'Payroll-to-Revenue Ratio Trend'}</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly payroll burden as % of revenue — target: below 30%</p>
            <div className="space-y-2">
              {data.map((d,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-12">{d.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full bg-blue-400" style={{ width: `${d.revenue/maxRev*100}%` }} />
                  </div>
                  <span className="text-xs font-bold w-14 text-right" style={{ color: d.ratio > 50 ? '#ef4444' : d.ratio > 30 ? '#f59e0b' : '#10b981' }}>
                    {d.revenue > 0 ? `${d.ratio.toFixed(0)}%` : 'N/A'}
                  </span>
                  <span className="text-xs text-gray-400 w-24 text-right">{fmtAna(d.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">Monthly payroll base: {fmtAna(totalPayroll,'full',0)}</p>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 5 && (() => {
        const now = new Date();
        const last90Rev = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 90;
        }).reduce((s,o) => s+o.totalPrice, 0);
        const activeEmps = employees.filter(e => e.status === 'Aktif');
        const totalPayroll = activeEmps.reduce((s,e) => s + (e.salary || 0), 0);
        const annualPayroll = totalPayroll * 12;
        const annualRevEst = last90Rev * (365 / 90);
        const revenuePerEmp = activeEmps.length > 0 ? annualRevEst / activeEmps.length : 0;
        const payrollRatio = annualRevEst > 0 ? (annualPayroll / annualRevEst * 100) : 0;
        const deptData: Record<string, {count:number; payroll:number}> = {};
        activeEmps.forEach(e => {
          const dept = e.department || 'Other';
          if (!deptData[dept]) deptData[dept] = { count: 0, payroll: 0 };
          deptData[dept].count++;
          deptData[dept].payroll += e.salary || 0;
        });
        const depts = Object.entries(deptData).sort((a,b)=>b[1].payroll-a[1].payroll).slice(0,5);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? 'Çalışan Verimlilik Oranları' : 'Employee Efficiency Ratios'}</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-blue-700">{fmtAna(revenuePerEmp,'K',0)}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Revenue/Employee (Annual)</div>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: payrollRatio <= 25 ? '#f0fdf4' : payrollRatio <= 40 ? '#fffbeb' : '#fef2f2' }}>
                <div className="text-lg font-black" style={{ color: payrollRatio <= 25 ? '#10b981' : payrollRatio <= 40 ? '#f59e0b' : '#ef4444' }}>{payrollRatio.toFixed(1)}%</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Payroll/Revenue Ratio</div>
              </div>
              <div className="bg-purple-50 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-purple-700">{activeEmps.length}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Active Employees</div>
              </div>
            </div>
            <div className="space-y-2">
              {depts.map(([dept, d], i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 w-32 truncate">{dept}</span>
                  <span className="text-gray-400">{d.count} staff</span>
                  <span className="font-medium text-gray-800">{fmtAna(d.payroll,'full',0)}/mo</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const deptCounts: Record<string, number> = {};
        employees.filter(e=>e.status==='Aktif').forEach(e => {
          const dept = e.department || 'Other';
          deptCounts[dept] = (deptCounts[dept]||0)+1;
        });
        const depts = Object.entries(deptCounts).sort((a,b)=>b[1]-a[1]);
        if (depts.length === 0) return null;
        const total = depts.reduce((s,[,c])=>s+c,0);
        const maxCount = Math.max(...depts.map(([,c])=>c));
        const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Departmana Göre Çalışan Sayısı' : 'Headcount by Department'}</h3>
            <p className="text-xs text-gray-500 mb-4">Active employees: {total} across {depts.length} departments</p>
            <div className="space-y-2">
              {depts.map(([dept,count],i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{dept}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxCount>0?(count/maxCount*100):0}%`, background: colors[i%colors.length] }} />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-6 text-right">{count}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{total>0?((count/total)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 5 && (() => {
        const now = new Date();
        const annualRev = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 365;
        }).reduce((s,o)=>s+o.totalPrice,0);
        const deptData: Record<string, {count: number; payroll: number}> = {};
        employees.filter(e=>e.status==='Aktif').forEach(e => {
          const dept = e.department || 'Other';
          if (!deptData[dept]) deptData[dept] = { count: 0, payroll: 0 };
          deptData[dept].count++;
          deptData[dept].payroll += e.salary || 0;
        });
        const totalEmps = Object.values(deptData).reduce((s,d)=>s+d.count,0);
        const depts = Object.entries(deptData).map(([dept, d]) => ({
          dept,
          count: d.count,
          payroll: d.payroll * 12,
          revShare: totalEmps > 0 ? annualRev * (d.count/totalEmps) : 0,
          revPerHead: totalEmps > 0 ? annualRev * (d.count/totalEmps) / d.count : 0,
        })).sort((a,b)=>b.revPerHead-a.revPerHead);
        if (depts.length === 0) return null;
        const maxRevPerHead = Math.max(...depts.map(d=>d.revPerHead), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Departmana Göre Çalışan Başına Ciro' : 'Revenue per Employee by Department'}</h3>
            <p className="text-xs text-gray-500 mb-4">Annual revenue allocated proportionally by headcount</p>
            <div className="space-y-2">
              {depts.map((d,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{d.dept}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-teal-500" style={{ width: `${maxRevPerHead>0?(d.revPerHead/maxRevPerHead*100):0}%` }} />
                  </div>
                  <span className="text-xs font-bold text-teal-700 w-20 text-right">{fmtAna(d.revPerHead,'K',0)}/emp</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const now = new Date();
        const tenureData = employees.filter(e=>e.status==='Aktif' && e.startDate).map(e => {
          const start = new Date(e.startDate);
          const months = Math.floor((now.getTime()-start.getTime())/(86400000*30));
          return { name: e.name, months, years: months/12, dept: e.department };
        });
        if (tenureData.length === 0) return null;
        const buckets = [
          { label: '< 6 months', min: 0, max: 6, color: '#94a3b8' },
          { label: '6–12 months', min: 6, max: 12, color: '#3b82f6' },
          { label: '1–2 years', min: 12, max: 24, color: '#10b981' },
          { label: '2–5 years', min: 24, max: 60, color: '#f59e0b' },
          { label: '5+ years', min: 60, max: Infinity, color: '#8b5cf6' },
        ];
        const bucketData = buckets.map(b => ({
          ...b,
          count: tenureData.filter(e=>e.months>=b.min && e.months<b.max).length,
        }));
        const avgTenure = tenureData.reduce((s,e)=>s+e.years,0)/tenureData.length;
        const maxCount = Math.max(...bucketData.map(b=>b.count),1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Çalışan Kıdem Dağılımı' : 'Employee Tenure Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Active employees · avg tenure: {avgTenure.toFixed(1)} years</p>
            <div className="space-y-2">
              {bucketData.map((b,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-24">{b.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxCount>0?(b.count/maxCount*100):0}%`, background: b.color }} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right" style={{ color: b.color }}>{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const active = employees.filter(e => e.status === 'Aktif' && e.salary > 0);
        if (active.length === 0) return null;
        const salaries = active.map(e => e.salary).sort((a, b) => a - b);
        const min = salaries[0];
        const max = salaries[salaries.length - 1];
        const avg = salaries.reduce((s, v) => s + v, 0) / salaries.length;
        const median = salaries[Math.floor(salaries.length / 2)];
        const range = max - min || 1;
        const bucketSize = range / 5;
        const buckets = Array.from({length: 5}, (_, i) => {
          const lo = min + i * bucketSize;
          const hi = min + (i + 1) * bucketSize;
          const count = salaries.filter(s => s >= lo && (i === 4 ? s <= hi : s < hi)).length;
          return {label: `₺${(lo / 1000).toFixed(0)}k–${(hi / 1000).toFixed(0)}k`, count};
        });
        const maxCount = Math.max(...buckets.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Maaş Bandı Dağılımı' : 'Salary Band Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Active employees · avg: {fmtAna(avg,'full',0)} · median: {fmtAna(median,'full',0)}</p>
            <div className="flex items-end gap-2 h-20 mb-3">
              {buckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-500">{b.count}</span>
                  <div className="w-full rounded-t bg-violet-500" style={{height: `${maxCount > 0 ? Math.max(4, b.count / maxCount * 60) : 4}px`}} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1 text-center">
              {buckets.map((b, i) => (
                <div key={i} className="text-[8px] text-gray-400">{b.label}</div>
              ))}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-gray-500">
              <span>Min: {fmtAna(min,'full',0)}</span>
              <span>Max: {fmtAna(max,'full',0)}</span>
            </div>
          </div>
        );
      })()}


      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const deptCost: Record<string, {headcount: number; cost: number}> = {};
        employees.forEach(e => {
          const dept = e.department || 'Unknown';
          if (!deptCost[dept]) deptCost[dept] = {headcount: 0, cost: 0};
          deptCost[dept].headcount++;
          deptCost[dept].cost += (e.salary || 0);
        });
        const deptRows = Object.entries(deptCost).map(([dept, d]) => ({dept, ...d, avgCost: d.headcount > 0 ? d.cost / d.headcount : 0})).sort((a, b) => b.cost - a.cost);
        if (deptRows.length < 2) return null;
        const totalCost329 = deptRows.reduce((s, d) => s + d.cost, 0);
        const maxCost329 = Math.max(...deptRows.map(d => d.cost), 1);
        const colors329 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Departman Maaş Maliyeti' : 'Department Salary Cost'}</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly payroll by department · Total: {fmtAna(totalCost329,'full',0)}</p>
            <div className="space-y-2">
              {deptRows.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{d.dept}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(d.cost / maxCost329) * 100}%`, background: colors329[i % colors329.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{d.headcount} emp</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors329[i % colors329.length]}}>{fmtAna(d.cost,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const toTs338 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthCount: Record<string, number> = {};
        employees.forEach(e => {
          const ts = toTs338((e as unknown as Record<string,unknown>).startDate || (e as unknown as Record<string,unknown>).createdAt || (e as unknown as Record<string,unknown>).hireDate);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthCount[key] = (monthCount[key] || 0) + 1;
        });
        const keys338 = Object.keys(monthCount).sort().slice(-8);
        if (keys338.length < 2) return null;
        let cumulative = 0;
        const cumulData = keys338.map(k => { cumulative += monthCount[k]; return {k, added: monthCount[k], total: cumulative}; });
        const maxTotal = Math.max(...cumulData.map(d => d.total), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Çalışan Sayısı Artışı' : 'Headcount Growth'}</h3>
            <p className="text-xs text-gray-500 mb-4">Cumulative employee count by hire month · Current: {employees.length}</p>
            <div className="flex items-end gap-2 h-24">
              {cumulData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.total}</span>
                  <div className="w-full rounded-t-lg bg-violet-400 transition-all" style={{height: `${Math.max((d.total / maxTotal) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}


      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const posMap: Record<string, {count: number; totalSalary: number}> = {};
        employees.forEach(e => {
          const pos = (e as unknown as Record<string,unknown>).position as string || (e as unknown as Record<string,unknown>).jobTitle as string || e.department || 'Unknown';
          if (!posMap[pos]) posMap[pos] = {count: 0, totalSalary: 0};
          posMap[pos].count++;
          posMap[pos].totalSalary += e.salary || 0;
        });
        const positions = Object.entries(posMap).map(([pos, d]) => ({pos, ...d, avg: d.count > 0 ? d.totalSalary / d.count : 0})).sort((a, b) => b.avg - a.avg);
        if (positions.length < 2) return null;
        const maxAvg = Math.max(...positions.map(p => p.avg), 1);
        const overallAvg = employees.reduce((s, e) => s + (e.salary || 0), 0) / (employees.length || 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Pozisyona Göre Ortalama Maaş' : 'Avg Salary by Position'}</h3>
            <p className="text-xs text-gray-500 mb-4">Company average: {fmtAna(overallAvg,'full',0)}/mo</p>
            <div className="space-y-2">
              {positions.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{p.pos}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-violet-400 transition-all" style={{width: `${(p.avg / maxAvg) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{p.count}×</span>
                  <span className="text-xs font-bold text-violet-600 w-24 text-right">{fmtAna(p.avg,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const withOT = employees.filter(e => (e as unknown as Record<string,unknown>).overtimeHours as number > 0);
        const withAbsence = employees.filter(e => (e as unknown as Record<string,unknown>).absenceDays as number > 0);
        const totalOT = employees.reduce((s, e) => s + (((e as unknown as Record<string,unknown>).overtimeHours as number) || 0), 0);
        const totalAbsence = employees.reduce((s, e) => s + (((e as unknown as Record<string,unknown>).absenceDays as number) || 0), 0);
        if (totalOT === 0 && totalAbsence === 0) return null;
        const otRate = (withOT.length / employees.length * 100).toFixed(0);
        const absRate = (withAbsence.length / employees.length * 100).toFixed(0);
        const topOT = [...employees].sort((a, b) => (((b as unknown as Record<string,unknown>).overtimeHours as number)||0) - (((a as unknown as Record<string,unknown>).overtimeHours as number)||0)).slice(0, 5);
        const maxOT = Math.max(...topOT.map(e => (((e as unknown as Record<string,unknown>).overtimeHours as number)||0)), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Fazla Mesai ve Devamsızlık Genel Bakış' : 'Overtime & Absence Overview'}</h3>
            <div className="flex gap-6 mb-4">
              <div className="text-center"><p className="text-2xl font-black text-amber-500">{otRate}%</p><p className="text-[10px] text-gray-400">with OT ({withOT.length})</p></div>
              <div className="text-center"><p className="text-2xl font-black text-red-500">{absRate}%</p><p className="text-[10px] text-gray-400">with absences ({withAbsence.length})</p></div>
              <div className="text-center"><p className="text-2xl font-black text-gray-700">{totalOT.toLocaleString('tr-TR')}</p><p className="text-[10px] text-gray-400">total OT hrs</p></div>
              <div className="text-center"><p className="text-2xl font-black text-gray-700">{totalAbsence}</p><p className="text-[10px] text-gray-400">absence days</p></div>
            </div>
            {totalOT > 0 && (
              <div className="space-y-1.5">
                {topOT.filter(e => (((e as unknown as Record<string,unknown>).overtimeHours as number)||0) > 0).map((e, i) => {
                  const ot: number = (((e as unknown as Record<string,unknown>).overtimeHours as number)||0);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-28 truncate">{e.name}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-amber-400" style={{width: `${(ot / maxOT) * 100}%`}} />
                      </div>
                      <span className="text-xs font-bold text-amber-600 w-12 text-right">{ot}h OT</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && orders.length >= 3 && (() => {
        const toTs360 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const totalSalary = employees.reduce((s, e) => s + (e.salary || 0), 0);
        const monthRevMap: Record<string, number> = {};
        orders.forEach(o => {
          const d = new Date(toTs360(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthRevMap[key] = (monthRevMap[key] || 0) + (o.totalPrice || 0);
        });
        const keys360 = Object.keys(monthRevMap).sort().slice(-6);
        if (keys360.length < 2) return null;
        const ratioData = keys360.map(k => ({
          k,
          rev: monthRevMap[k],
          ratio: monthRevMap[k] > 0 ? (totalSalary / monthRevMap[k]) * 100 : 0,
        }));
        const avgRatio = ratioData.reduce((s, d) => s + d.ratio, 0) / ratioData.length;
        const maxRatio = Math.max(...ratioData.map(d => d.ratio), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Bordro/Ciro Oranı' : 'Payroll-to-Revenue Ratio'}</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly salary ({fmtAna(totalSalary,'full',0)}) as % of revenue · Avg: {avgRatio.toFixed(1)}%</p>
            <div className="flex items-end gap-2 h-24">
              {ratioData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.ratio.toFixed(0)}%</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((d.ratio / maxRatio) * 72, 4)}px`, background: d.ratio > 40 ? '#ef4444' : d.ratio > 20 ? '#f59e0b' : '#10b981'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const deptHC: Record<string, number> = {};
        employees.forEach(e => { const d = e.department || 'Unknown'; deptHC[d] = (deptHC[d] || 0) + 1; });
        const totalHC = employees.length;
        const deptRows = Object.entries(deptHC).map(([dept, count]) => ({dept, count, pct: (count / totalHC) * 100})).sort((a, b) => b.count - a.count);
        if (deptRows.length < 2) return null;
        const colors366 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#8b5cf6','#ef4444'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Departmana Göre Çalışan Sayısı' : 'Headcount by Department'}</h3>
            <p className="text-xs text-gray-500 mb-4">{totalHC} employees across {deptRows.length} departments</p>
            <div className="space-y-2">
              {deptRows.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: colors366[i % colors366.length]}} />
                  <span className="text-xs text-gray-700 flex-1 truncate">{d.dept}</span>
                  <div className="w-32 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${d.pct}%`, background: colors366[i % colors366.length]}} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{color: colors366[i % colors366.length]}}>{d.count} ({d.pct.toFixed(0)}%)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const skillMap: Record<string, number> = {};
        employees.forEach(e => {
          const skills = (e as unknown as Record<string,unknown>).skills as string[] | string | undefined;
          const arr = Array.isArray(skills) ? skills : typeof skills === 'string' ? skills.split(',').map(s => s.trim()) : [];
          arr.filter(Boolean).forEach(s => { skillMap[s] = (skillMap[s] || 0) + 1; });
        });
        const topSkills = Object.entries(skillMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
        if (topSkills.length < 2) return null;
        const maxSkill = Math.max(...topSkills.map(([, c]) => c), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Yetkinlik Kapsama Matrisi' : 'Skill Coverage Matrix'}</h3>
            <p className="text-xs text-gray-500 mb-4">Number of employees with each skill</p>
            <div className="space-y-2">
              {topSkills.map(([skill, count], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{skill}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-sky-400 transition-all" style={{width: `${(count / maxSkill) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-sky-600 w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const joinByMonth: Record<string, number> = {};
        employees.forEach(e => {
          const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
          if (!d || isNaN(d.getTime())) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          joinByMonth[key] = (joinByMonth[key] ?? 0) + 1;
        });
        const months = Object.keys(joinByMonth).sort().slice(-9);
        if (months.length < 2) return null;
        let cumulative = 0;
        const rows = months.map(m => { cumulative += joinByMonth[m]; return { month: m.slice(5), new: joinByMonth[m], total: cumulative }; });
        // Reset and properly calculate cumulative
        const allBefore = employees.filter(e => {
          const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
          if (!d || isNaN(d.getTime())) return false;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          return key < months[0];
        }).length;
        let running = allBefore;
        const finalRows = months.map(m => { running += joinByMonth[m]; return { month: m.slice(5), new: joinByMonth[m], cumulative: running }; });
        const maxC = Math.max(...finalRows.map(r => r.cumulative), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aya Göre Çalışan Sayısı Artışı' : 'Headcount Growth by Month'}</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {finalRows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm transition-all" style={{height: `${(r.cumulative / maxC) * 80}px`, background: '#6366f1'}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>+{finalRows.reduce((s,r) => s + r.new, 0)} in period</span>
              <span>Total: {finalRows[finalRows.length-1]?.cumulative ?? 0}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const deptData: Record<string, {count: number; salarySum: number}> = {};
        employees.forEach(e => {
          const dept = e.department ?? 'Other';
          if (!deptData[dept]) deptData[dept] = {count: 0, salarySum: 0};
          deptData[dept].count++;
          const sal = (e as unknown as Record<string,unknown>).salary as number | undefined
            || (e as unknown as Record<string,unknown>).baseSalary as number | undefined
            || (e as unknown as Record<string,unknown>).monthlySalary as number | undefined
            || 0;
          deptData[dept].salarySum += sal;
        });
        const rows = Object.entries(deptData).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
        if (rows.length === 0) return null;
        const maxCount = Math.max(...rows.map(r => r[1].count), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Departmana Göre Çalışan Sayısı' : 'Headcount by Department'}</h3>
            <div className="space-y-2">
              {rows.map(([dept, d]) => (
                <div key={dept} className="flex items-center gap-2">
                  <span className="text-xs truncate w-20 text-gray-700">{dept}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(d.count / maxCount) * 100}%`, background: '#6366f1'}}>
                      <span className="text-white text-[9px] font-bold">{d.count}</span>
                    </div>
                  </div>
                  {d.salarySum > 0 && <span className="text-[9px] text-gray-400 w-16 text-right">avg {fmtAna(Math.round(d.salarySum / d.count))}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const now = new Date();
        const tenures = employees.map(e => {
          const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
          if (!d || isNaN(d.getTime())) return null;
          return (now.getTime() - d.getTime()) / (365.25 * 86400000);
        }).filter((t): t is number => t !== null && t >= 0);
        if (tenures.length < 2) return null;
        const buckets = [[0,0.5,'<6mo'],[0.5,1,'6-12mo'],[1,2,'1-2yr'],[2,5,'2-5yr'],[5,10,'5-10yr'],[10,100,'10yr+']];
        const counts = buckets.map(([lo,hi,lbl]) => ({
          label: lbl as string,
          count: tenures.filter(t => t >= (lo as number) && t < (hi as number)).length,
        }));
        const maxC = Math.max(...counts.map(c => c.count), 1);
        const avgTenure = tenures.reduce((a,b) => a+b, 0) / tenures.length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Çalışan Kıdem Dağılımı' : 'Employee Tenure Distribution'}</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">avg {avgTenure.toFixed(1)}yr</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {counts.map(c => (
                <div key={c.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{c.count > 0 ? c.count : ''}</span>
                  <div className="w-full rounded-sm" style={{height: `${(c.count / maxC) * 56}px`, background: '#6366f1', minHeight: c.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 1 && orders.length >= 1 && (() => {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
        const ytdStart = new Date(now.getFullYear(), 0, 1);
        let rev30 = 0, revYTD = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (d >= thirtyDaysAgo) rev30 += total;
          if (d >= ytdStart) revYTD += total;
        });
        const activeCount = employees.filter(e => (e as unknown as Record<string,unknown>).status !== 'Inactive').length || employees.length;
        const rpe30 = activeCount > 0 ? rev30 / activeCount : 0;
        const rpeYTD = activeCount > 0 ? revYTD / activeCount : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Çalışan Başına Ciro' : 'Revenue per Employee'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {[{label:'Last 30 Days', val: rpe30, color: '#3b82f6'}, {label:'YTD', val: rpeYTD, color: '#ff4000'}].map(r => (
                <div key={r.label} className="rounded-xl p-3 text-center" style={{background: `${r.color}12`}}>
                  <p className="text-lg font-bold" style={{color: r.color}}>{fmtAna(r.val,'K',1)}</p>
                  <p className="text-[10px] text-gray-500">{r.label}</p>
                  <p className="text-[9px] text-gray-400">{activeCount} employees</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const salaries = employees.map(e => {
          const eR = e as unknown as Record<string,unknown>;
          return (eR.salary as number|undefined) ?? (eR.baseSalary as number|undefined) ?? (eR.monthlySalary as number|undefined) ?? 0;
        }).filter(s => s > 0);
        if (salaries.length < 2) return null;
        const min = Math.min(...salaries); const max = Math.max(...salaries);
        const step = (max - min) / 5 || 1000;
        const buckets = Array.from({length: 5}, (_, i) => ({
          lo: min + i * step, hi: min + (i+1) * step,
          label: `₺${((min + i * step)/1000).toFixed(0)}k`,
          count: 0,
        }));
        salaries.forEach(s => {
          const idx = Math.min(Math.floor((s - min) / step), 4);
          buckets[idx].count++;
        });
        const maxC = Math.max(...buckets.map(b => b.count), 1);
        const avgSal = salaries.reduce((a,b)=>a+b,0)/salaries.length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Maaş Dağılımı' : 'Salary Distribution'}</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">avg {fmtAna(avgSal,'K',1)}</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {buckets.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{b.count > 0 ? b.count : ''}</span>
                  <div className="w-full rounded-sm" style={{height: `${(b.count / maxC) * 56}px`, background: '#6366f1', minHeight: b.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 3 && (() => {
        const types: Record<string, number> = {};
        employees.forEach(e => {
          const eR = e as unknown as Record<string,unknown>;
          const t = (eR.contractType as string|undefined) ?? (eR.employmentType as string|undefined) ?? (eR.type as string|undefined) ?? 'Full-time';
          types[t] = (types[t] ?? 0) + 1;
        });
        const total = employees.length;
        const rows = Object.entries(types).sort((a, b) => b[1] - a[1]);
        if (rows.length <= 1) {
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'İstihdam Türleri' : 'Employment Types'}</h3>
              <p className="text-sm text-gray-600">{total} {rows[0]?.[0] ?? 'Full-time'} employees</p>
            </div>
          );
        }
        const palette = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'İstihdam Türü Dağılımı' : 'Employment Type Breakdown'}</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([t, n], i) => (
                <div key={t} style={{width: `${(n/total)*100}%`, background: palette[i]}} title={`${t}: ${n}`} />
              ))}
            </div>
            <div className="space-y-1">
              {rows.map(([t, n], i) => (
                <div key={t} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background: palette[i]}} />
                    <span className="text-gray-600">{t}</span>
                  </div>
                  <span className="font-bold">{n} <span className="font-normal text-gray-400">({Math.round((n/total)*100)}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const deptEmployees: Record<string, number> = {};
        employees.forEach(e => {
          const dept = e.department ?? 'Other';
          deptEmployees[dept] = (deptEmployees[dept] ?? 0) + 1;
        });
        const totalEmp = employees.length;
        const activeEmp = employees.filter(e => (e as unknown as Record<string,unknown>).status !== 'Inactive').length || totalEmp;
        const avgTenure = (() => {
          const now = new Date();
          const tenures = employees.map(e => {
            const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
            if (!d || isNaN(d.getTime())) return null;
            return (now.getTime() - d.getTime()) / (365.25*86400000);
          }).filter((t): t is number => t !== null && t >= 0);
          return tenures.length > 0 ? tenures.reduce((a,b)=>a+b,0)/tenures.length : 0;
        })();
        const departments = Object.keys(deptEmployees).length;
        const metrics = [
          {label:'Active Staff', val: activeEmp, unit:'', color:'#22c55e'},
          {label:'Departments', val: departments, unit:'', color:'#3b82f6'},
          {label:'Avg Tenure', val: parseFloat(avgTenure.toFixed(1)), unit:'yr', color:'#8b5cf6'},
          {label:'Total Headcount', val: totalEmp, unit:'', color:'#ff4000'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'İK Genel Bakış' : 'HR Overview'}</h3>
            <div className="grid grid-cols-2 gap-2">
              {metrics.map(m => (
                <div key={m.label} className="rounded-xl p-3" style={{background: `${m.color}12`}}>
                  <p className="text-xl font-bold" style={{color: m.color}}>{m.val}{m.unit}</p>
                  <p className="text-[10px] text-gray-500">{m.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 1 && (() => {
        const now = new Date();
        const ninetyAgo = new Date(now.getTime() - 90 * 86400000);
        const recent = employees
          .map(e => {
            const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.() ?? new Date(e.startDate as string)) : null;
            if (!d || isNaN(d.getTime()) || d < ninetyAgo) return null;
            const eR = e as unknown as Record<string,unknown>;
            return {
              name: (eR.name as string|undefined) ?? (eR.firstName as string|undefined) ?? 'Employee',
              dept: e.department ?? '',
              startDate: d,
              daysAgo: Math.floor((now.getTime() - d.getTime()) / 86400000),
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)
          .sort((a,b) => b.startDate.getTime() - a.startDate.getTime());
        if (recent.length === 0) return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">Recent Hires (90d)</h3>
            <p className="text-sm text-gray-500">No new hires in the last 90 days</p>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🆕 Recent Hires</span>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{recent.length} in 90d</span>
            </h3>
            <div className="space-y-2">
              {recent.map((e, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{e.name}</span>
                  {e.dept && <span className="text-gray-400">{e.dept}</span>}
                  <span className="text-green-600 font-bold">{e.daysAgo === 0 ? 'Today' : `${e.daysAgo}d ago`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 1 && (() => {
        const statusCounts: Record<string, number> = {};
        employees.forEach(e => {
          const eR = e as unknown as Record<string,unknown>;
          const status = (eR.status as string|undefined) ?? (eR.employmentStatus as string|undefined) ?? 'Active';
          statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        });
        const rows = Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]);
        const total = employees.length;
        const statusColors: Record<string,string> = {
          'Active':'#22c55e','Full-time':'#22c55e','Part-time':'#3b82f6',
          'Inactive':'#ef4444','On Leave':'#f59e0b','Contract':'#8b5cf6',
        };
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Çalışan Durumu Genel Bakış' : 'Employee Status Overview'}</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([status,n]) => <div key={status} style={{width:`${(n/total)*100}%`,background:statusColors[status]??'#6b7280'}} title={status} />)}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {rows.map(([status,n]) => (
                <div key={status} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:statusColors[status]??'#6b7280'}} />
                  <span className="text-gray-600 truncate">{status}</span>
                  <span className="ml-auto font-bold">{n}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const salaries = employees.map(e => {
          const eR = e as unknown as Record<string,unknown>;
          return (eR.salary as number|undefined)??(eR.baseSalary as number|undefined)??(eR.monthlySalary as number|undefined)??0;
        });
        const hasSalaryData = salaries.some(s=>s>0);
        if (!hasSalaryData) return null;
        const totalPayroll = salaries.reduce((a,b)=>a+b,0);
        const avgSalary = salaries.filter(s=>s>0).reduce((a,b)=>a+b,0) / (salaries.filter(s=>s>0).length||1);
        const minSal = Math.min(...salaries.filter(s=>s>0));
        const maxSal = Math.max(...salaries.filter(s=>s>0));
        const percentiles = salaries.filter(s=>s>0).sort((a,b)=>a-b);
        const median = percentiles.length > 0 ? percentiles[Math.floor(percentiles.length/2)] : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aylık Bordro Tahmini' : 'Monthly Payroll Estimate'}</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-xl p-3 bg-indigo-50">
                <p className="text-xl font-bold text-indigo-600">{fmtAna(totalPayroll,'K',0)}</p>
                <p className="text-[10px] text-gray-500">Total monthly</p>
              </div>
              <div className="rounded-xl p-3 bg-purple-50">
                <p className="text-xl font-bold text-purple-600">{fmtAna(median,'K',1)}</p>
                <p className="text-[10px] text-gray-500">Median salary</p>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Min: {fmtAna(minSal,'K',1)}</span>
              <span>Avg: {fmtAna(avgSalary,'K',1)}</span>
              <span>Max: {fmtAna(maxSal,'K',1)}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 1 && (() => {
        const now = new Date();
        const in60 = new Date(now.getTime()+60*86400000);
        const upcoming = employees
          .map(e => {
            const d = e.startDate ? ((e.startDate as unknown as {toDate?:()=>Date}).toDate?.()??new Date(e.startDate as string)) : null;
            if (!d || isNaN(d.getTime())) return null;
            const nextAnniv = new Date(now.getFullYear(),d.getMonth(),d.getDate());
            if (nextAnniv < now) nextAnniv.setFullYear(now.getFullYear()+1);
            if (nextAnniv > in60) return null;
            const daysUntil = Math.ceil((nextAnniv.getTime()-now.getTime())/86400000);
            const eR = e as unknown as Record<string,unknown>;
            return {
              name: (eR.name as string|undefined)??(eR.firstName as string|undefined)??'Employee',
              years: nextAnniv.getFullYear()-d.getFullYear(),
              daysUntil,
              dept: e.department??'',
            };
          })
          .filter((e): e is NonNullable<typeof e> => e!==null)
          .sort((a,b)=>a.daysUntil-b.daysUntil);
        if (upcoming.length===0) return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">Work Anniversaries (60d)</h3>
            <p className="text-sm text-gray-500">No anniversaries in next 60 days</p>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🎉 Upcoming Anniversaries</span>
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">{upcoming.length}</span>
            </h3>
            <div className="space-y-2">
              {upcoming.map((e,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{e.name}</span>
                  <span className="text-purple-600 font-bold">{e.years}yr</span>
                  <span className="text-gray-400">{e.daysUntil===0?'Today':`in ${e.daysUntil}d`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 1 && orders.length >= 1 && (() => {
        const salesDept = employees.filter(e => {
          const dept = (e.department??'').toLowerCase();
          return dept.includes('sales')||dept.includes('satış')||dept.includes('crm');
        });
        const salesCount = salesDept.length || 1;
        const now = new Date();
        const d30 = new Date(now.getTime()-30*86400000);
        const d90 = new Date(now.getTime()-90*86400000);
        let orders30=0,orders90=0,rev30=0,rev90=0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (d>=d30) { orders30++; rev30+=total; }
          if (d>=d90) { orders90++; rev90+=total; }
        });
        const metrics = [
          {label:'Orders/rep (30d)', val:(orders30/salesCount).toFixed(1), color:'#3b82f6'},
          {label:'Rev/rep (30d)', val:`₺${((rev30/salesCount)/1000).toFixed(1)}k`, color:'#ff4000'},
          {label:'Orders/rep (90d)', val:(orders90/salesCount).toFixed(1), color:'#22c55e'},
          {label:'Rev/rep (90d)', val:`₺${((rev90/salesCount)/1000).toFixed(1)}k`, color:'#8b5cf6'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'Satış Verimliliği' : 'Sales Productivity'}</h3>
            <p className="text-[10px] text-gray-400 mb-3">{salesDept.length>0?`${salesDept.length} sales rep${salesDept.length>1?'s':''}`:'All staff as baseline'}</p>
            <div className="grid grid-cols-2 gap-2">
              {metrics.map(m=>(
                <div key={m.label} className="rounded-xl p-3" style={{background:`${m.color}12`}}>
                  <p className="text-lg font-bold" style={{color:m.color}}>{m.val}</p>
                  <p className="text-[10px] text-gray-500">{m.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const skillCounts: Record<string,number> = {};
        employees.forEach(e => {
          const eR = e as unknown as Record<string,unknown>;
          const skills = (eR.skills as string[]|undefined) ?? [];
          const skillStr = (eR.skillList as string|undefined)??(eR.skillsText as string|undefined)??'';
          const allSkills = [...skills, ...skillStr.split(/[,;]/g).map((s:string)=>s.trim()).filter(Boolean)];
          allSkills.forEach(s => { if (s) skillCounts[s]=(skillCounts[s]??0)+1; });
        });
        const topSkills = Object.entries(skillCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
        if (topSkills.length===0) return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'Yetkinlik Genel Bakış' : 'Skills Overview'}</h3>
            <p className="text-sm text-gray-500">{employees.length} employees — skill data not yet recorded</p>
          </div>
        );
        const maxCount = topSkills[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Ekipteki En Yaygın Yetkinlikler' : 'Top Skills Across Team'}</h3>
            <div className="space-y-1.5">
              {topSkills.map(([skill,count])=>(
                <div key={skill} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{skill}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(count/maxCount)*100}%`,background:'#6366f1'}} />
                  </div>
                  <span className="text-xs font-bold text-indigo-600 w-4 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const total = employees.length;
        const active = employees.filter(e=>{ const s=(e as unknown as Record<string,unknown>).status as string|undefined; return !s||s==='Active'||s==='Full-time'||s==='Part-time'; }).length;
        const onLeave = employees.filter(e=>{ const s=(e as unknown as Record<string,unknown>).status as string|undefined; return s==='On Leave'; }).length;
        const inactive = total-active-onLeave;
        const retentionRate = total>0 ? Math.round((active/total)*100) : 100;
        const now = new Date();
        const newIn90 = employees.filter(e=>{ const d=e.startDate?((e.startDate as unknown as {toDate?:()=>Date}).toDate?.()??new Date(e.startDate as string)):null; return d&&!isNaN(d.getTime())&&(now.getTime()-d.getTime())/(86400000)<90; }).length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'İşgücü Kalıcılığı' : 'Workforce Retention'}</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <p className="text-3xl font-bold" style={{color:retentionRate>=90?'#22c55e':retentionRate>=70?'#f59e0b':'#ef4444'}}>{retentionRate}%</p>
                <p className="text-[10px] text-gray-500">retention rate</p>
              </div>
              <div className="flex-1 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-green-600">Active</span><span className="font-bold">{active}</span></div>
                {onLeave>0&&<div className="flex justify-between"><span className="text-yellow-600">On Leave</span><span className="font-bold">{onLeave}</span></div>}
                {inactive>0&&<div className="flex justify-between"><span className="text-gray-400">Inactive</span><span className="font-bold">{inactive}</span></div>}
                {newIn90>0&&<div className="flex justify-between"><span className="text-blue-500">New (90d)</span><span className="font-bold text-blue-500">+{newIn90}</span></div>}
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 2 && (() => {
        const ratings=employees.map(e=>{
          const eR=e as unknown as Record<string,unknown>;
          return (eR.performanceRating as number|undefined)??(eR.rating as number|undefined)??(eR.score as number|undefined)??null;
        }).filter((r): r is number=>r!==null&&r>0);
        if(ratings.length<2) {
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'Performans Değerlendirmeleri' : 'Performance Ratings'}</h3>
              <p className="text-sm text-gray-500">{employees.length} employees — no performance data yet</p>
            </div>
          );
        }
        const avg=ratings.reduce((a,b)=>a+b,0)/ratings.length;
        const bins=[1,2,3,4,5].map(s=>({star:s,count:ratings.filter(r=>Math.round(r)===s).length}));
        const maxBin=Math.max(...bins.map(b=>b.count),1);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Performans Değerlendirmeleri' : 'Performance Ratings'}</h3>
              <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">avg {avg.toFixed(1)}★</span>
            </div>
            <div className="space-y-1.5">
              {bins.map(b=>(
                <div key={b.star} className="flex items-center gap-2">
                  <span className="text-xs text-yellow-500 w-6">{b.star}★</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(b.count/maxBin)*100}%`,background:'#f59e0b'}}/>
                  </div>
                  <span className="text-xs text-gray-500 w-4 text-right">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'ik' && employees.length >= 1 && (() => {
        const now=new Date();
        const d90=new Date(now.getTime()-90*86400000);
        const onboarding=employees
          .map(e=>{
            const d=e.startDate?((e.startDate as unknown as {toDate?:()=>Date}).toDate?.()??new Date(e.startDate as string)):null;
            if(!d||isNaN(d.getTime())||d<d90) return null;
            const eR=e as unknown as Record<string,unknown>;
            const daysIn=Math.floor((now.getTime()-d.getTime())/86400000);
            return { name:(eR.name as string|undefined)??(eR.firstName as string|undefined)??'New Hire', dept:e.department??'', daysIn, progress:Math.min(Math.round((daysIn/90)*100),100) };
          })
          .filter((e): e is NonNullable<typeof e>=>e!==null)
          .sort((a,b)=>b.daysIn-a.daysIn);
        if(onboarding.length===0) return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'İşe Alım Sırası' : 'Onboarding Queue'}</h3>
            <p className="text-sm text-gray-500">No employees in their first 90 days</p>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🎓 Onboarding (90-day)</span>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{onboarding.length}</span>
            </h3>
            <div className="space-y-3">
              {onboarding.map((e,i)=>(
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{e.name}{e.dept&&<span className="text-gray-400"> · {e.dept}</span>}</span>
                    <span className="text-gray-500">Day {e.daysIn}/90</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${e.progress}%`,background:e.progress>=75?'#22c55e':e.progress>=40?'#3b82f6':'#f59e0b'}}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
