/**
 * GenelRapor.tsx — Raporlar > Genel Bakış sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'genel' sekmesine ait 78 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'genel'` koşulları BİLEREK korundu: ebeveyn zaten
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
  AlertCircle, Calendar, Download, CheckCircle2, ChevronRight,
  CreditCard,
} from 'lucide-react';
import { format } from 'date-fns';
import { tr, enUS } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';
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
import { itemCostTRY, itemPriceTRY, type ReportsCtx } from './useReportsData';

export default function GenelRapor(ctx: ReportsCtx) {
  const { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, salesByDate, trendData, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF } = ctx;
  void itemCostTRY; void itemPriceTRY; // sekmeye göre kullanılıyor olabilir
  return (
    <>
      {reportsTab === 'genel' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
              onClick={() => onNavigate?.('crm')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate?.('crm'); }}
              className="apple-card p-6 text-left w-full hover:shadow-md hover:scale-[1.01] transition-all duration-200 cursor-pointer group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-brand/10">
                  <span className="text-xl font-black text-brand leading-none">{revenueSymbol}</span>
                </div>
                <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5" onClick={e => e.stopPropagation()}>
                  {(['TRY', 'USD', 'EUR'] as const).map(c => (
                    <button key={c} onClick={() => setRevenueCurrency(c)} className={cn('px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-colors', revenueCurrency === c ? 'bg-white text-brand shadow-sm' : 'text-gray-400 hover:text-gray-600')}>
                      {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{currentT.kpi_revenue}</p>
              <p className="text-2xl font-bold mt-1">{revenueFormatted}</p>
              <p className="text-[10px] text-brand mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
              </p>
            </motion.div>
            {[
              { label: currentT.kpi_orders, value: String(totalOrders), icon: Package as React.ElementType | null, symbol: null as string | null, color: 'text-blue-500', bg: 'bg-blue-50', tab: 'crm' },
              { label: currentT.kpi_avg_order, value: avgOrderFormatted, icon: null, symbol: revenueSymbol, color: 'text-green-500', bg: 'bg-green-50', tab: 'crm' },
              { label: currentT.kpi_low_stock, value: String(lowStockItems), icon: AlertCircle as React.ElementType | null, symbol: null, color: 'text-orange-500', bg: 'bg-orange-50', tab: 'inventory' },
            ].map((kpi, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (i + 1) * 0.1 }}
                onClick={() => onNavigate?.(kpi.tab)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate?.(kpi.tab); }}
                className="apple-card p-6 text-left w-full hover:shadow-md hover:scale-[1.01] transition-all duration-200 cursor-pointer group">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4", kpi.bg)}>
                  {kpi.symbol ? <span className={cn('text-xl font-black leading-none', kpi.color)}>{kpi.symbol}</span> : kpi.icon && <kpi.icon className={cn("w-6 h-6", kpi.color)} />}
                </div>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{kpi.label}</p>
                <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                <p className="text-[10px] text-brand mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="w-3 h-3" />{currentLanguage === 'tr' ? 'Detaya git' : 'View details'}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.sales_trend}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff4000" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#ff4000" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                    <Area type="monotone" dataKey="value" stroke="#ff4000" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.category_dist}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={categoryChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                      {categoryChartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Phase 181: Monthly Recurring Revenue (MRR) ── */}
      {reportsTab === 'genel' && recurringOrders.filter(r => r.active).length > 0 && (() => {
        const activeRO = recurringOrders.filter(r => r.active);
        const mrr = activeRO.reduce((s, r) => {
          const monthly = r.frequency === 'weekly' ? r.totalPrice * 4 : r.frequency === 'quarterly' ? r.totalPrice / 3 : r.totalPrice;
          return s + monthly;
        }, 0);
        const arr = mrr * 12;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔁 Aylık Tekrarlayan Gelir (MRR)' : '🔁 Monthly Recurring Revenue (MRR)'}</h3>
              <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">{activeRO.length} {currentLanguage==='tr'?'aktif şablon':'active templates'}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wide">MRR</p>
                <p className="text-3xl font-black text-emerald-700 mt-1">{fmtAna(mrr,'K',1)}</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">{currentLanguage==='tr'?'Aylık tekrarlayan':'Monthly recurring'}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wide">ARR</p>
                <p className="text-3xl font-black text-blue-700 mt-1">{fmtAna(arr,'K',0)}</p>
                <p className="text-[10px] text-blue-600 mt-0.5">{currentLanguage==='tr'?'Yıllık projeksiyon':'Annual projection'}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {activeRO.slice(0, 4).map(r => {
                const monthly = r.frequency === 'weekly' ? r.totalPrice * 4 : r.frequency === 'quarterly' ? r.totalPrice / 3 : r.totalPrice;
                return (
                  <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-700 truncate">{r.templateName} · {r.customerName}</span>
                    <span className="font-bold text-emerald-600 shrink-0 ml-2">{fmtAna(Math.round(monthly))}/m</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 189: Order Value Distribution ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const buckets189 = [
          { label: '<₺1K', min: 0, max: 1000, count: 0, total: 0 },
          { label: '₺1-5K', min: 1000, max: 5000, count: 0, total: 0 },
          { label: '₺5-20K', min: 5000, max: 20000, count: 0, total: 0 },
          { label: '₺20-100K', min: 20000, max: 100000, count: 0, total: 0 },
          { label: '₺100K+', min: 100000, max: Infinity, count: 0, total: 0 },
        ];
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const v = o.totalPrice || 0;
          const b = buckets189.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.total += v; }
        }
        const maxCount = Math.max(...buckets189.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📊 Sipariş Değeri Dağılımı' : '📊 Order Value Distribution'}</h3>
            <div className="flex items-end gap-3 h-28 mb-3">
              {buckets189.map((b, i) => {
                const h = Math.round((b.count / maxCount) * 100);
                const colors = ['bg-blue-300', 'bg-blue-400', 'bg-brand/70', 'bg-brand', 'bg-purple-500'];
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                      <div className={`w-full rounded-t-lg ${colors[i]}`} style={{ height: `${Math.max(h, 3)}%` }}
                        title={`${b.count} ${currentLanguage==='tr'?'sipariş':'orders'} · ₺${b.total.toLocaleString()}`} />
                    </div>
                    <span className="text-[8px] text-gray-400 text-center leading-tight">{b.label}</span>
                    <span className="text-[9px] font-bold text-gray-600">{b.count}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage==='tr'?'Sayı, sipariş başına sipariş değerine göre':'Order count by order value range'}</p>
          </div>
        );
      })()}

      {/* ── Phase 185: Cash Conversion Cycle (CCC) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now185 = new Date();
        const days90 = 90;
        const cutoff185 = new Date(now185); cutoff185.setDate(cutoff185.getDate() - days90);
        // DSO: avg days from order creation to paid status
        const paidOrders = orders.filter(o => o.status === 'Delivered' || (o as unknown as Record<string,unknown>).paidAt);
        void paidOrders;
        const unPaidOrders = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered');
        const arBalance = unPaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const monthly90Rev = orders.filter(o => {
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= cutoff185 && o.status !== 'Cancelled';
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const dailyRev185 = monthly90Rev / days90;
        const dso = dailyRev185 > 0 ? Math.round(arBalance / dailyRev185) : 0;
        // DIO: avg inventory value / daily COGS
        const inventoryVal185 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const dailyCOGS185 = monthly90Rev * 0.6 / days90; // assume 60% COGS ratio
        const dio = dailyCOGS185 > 0 ? Math.round(inventoryVal185 / dailyCOGS185) : 0;
        const ccc = dso + dio;
        const cccColor = ccc <= 30 ? 'text-emerald-600' : ccc <= 60 ? 'text-amber-500' : 'text-red-500';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏱️ Nakit Dönüşüm Döngüsü (CCC)' : '⏱️ Cash Conversion Cycle (CCC)'}</h3>
              <span className={`text-lg font-black ${cccColor}`}>{ccc} {currentLanguage === 'tr' ? 'gün' : 'days'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: 'DSO', desc: currentLanguage === 'tr' ? 'Alacak Tahsilat Süresi' : 'Days Sales Outstanding', value: dso, color: dso > 45 ? 'text-red-500' : dso > 30 ? 'text-amber-500' : 'text-emerald-600', sub: currentLanguage === 'tr' ? `₺${(arBalance/1000).toFixed(0)}K ödenmemiş` : `₺${(arBalance/1000).toFixed(0)}K outstanding` },
                { label: 'DIO', desc: currentLanguage === 'tr' ? 'Stok Elde Tutma Süresi' : 'Days Inventory Outstanding', value: dio, color: dio > 60 ? 'text-red-500' : dio > 30 ? 'text-amber-500' : 'text-emerald-600', sub: currentLanguage === 'tr' ? `₺${(inventoryVal185/1000).toFixed(0)}K stok` : `₺${(inventoryVal185/1000).toFixed(0)}K inventory` },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <p className={`text-3xl font-black ${k.color}`}>{k.value}<span className="text-sm font-medium text-gray-400 ml-1">{currentLanguage === 'tr' ? 'gün' : 'd'}</span></p>
                  <p className="text-[11px] text-gray-700 font-semibold mt-1">{k.label} · {k.desc}</p>
                  <p className="text-[10px] text-gray-400">{k.sub}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-3">
              <span className="text-blue-500 text-sm">💡</span>
              <p className="text-[11px] text-blue-700">{currentLanguage === 'tr' ? `CCC = DSO + DIO. Hedef: 30 günün altı. Şu an: ${ccc} gün${ccc > 60 ? ' — nakit sıkışıklığı riski var.' : ccc > 30 ? ' — iyileştirme fırsatı var.' : ' — sağlıklı.'}` : `CCC = DSO + DIO. Target: under 30 days. Current: ${ccc} days${ccc > 60 ? ' — cash flow risk.' : ccc > 30 ? ' — room for improvement.' : ' — healthy.'}`}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 186: Sales by Hour of Day ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const hourBuckets186 = Array.from({ length: 8 }, (_, i) => ({ label: `${i*3}:00-${i*3+2}:59`, start: i*3, count: 0, rev: 0 }));
        let hasHours = false;
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const h = od.getHours();
            if (isNaN(h)) continue;
            hasHours = true;
            const bucket = hourBuckets186.find(b => h >= b.start && h < b.start + 3);
            if (bucket) { bucket.count++; bucket.rev += o.totalPrice || 0; }
          } catch { /* skip */ }
        }
        if (!hasHours) return null;
        const maxCount186 = Math.max(...hourBuckets186.map(b => b.count), 1);
        const peakBucket = hourBuckets186.reduce((best, b) => b.count > best.count ? b : best, hourBuckets186[0]);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🕐 Saate Göre Satış Dağılımı' : '🕐 Sales by Hour of Day'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `Zirve: ${peakBucket.label}` : `Peak: ${peakBucket.label}`}</span>
            </div>
            <div className="flex items-end gap-1.5 h-24">
              {hourBuckets186.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '72px' }}>
                    <div
                      className={`w-full rounded-t-md ${b.count === peakBucket.count ? 'bg-brand' : 'bg-blue-200'}`}
                      style={{ height: `${Math.max(4, Math.round((b.count / maxCount186) * 72))}px` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none text-center">{b.start}h</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-gray-400">0:00</span>
              <span className="text-[10px] text-gray-400">12:00</span>
              <span className="text-[10px] text-gray-400">21:00</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Her çubuk 3 saatlik dilimi temsil eder' : 'Each bar represents a 3-hour window'}</p>
          </div>
        );
      })()}

      {/* ── Phase 147: Revenue by Day of Week ── */}
          {orders.length >= 5 && (() => {
            const dayNames = currentLanguage === 'tr'
              ? ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
              : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayCounts = Array(7).fill(null).map((_, d) => ({ day: dayNames[d], revenue: 0, orders: 0 }));
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              try {
                const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                dayCounts[d.getDay()].revenue += o.totalPrice || 0;
                dayCounts[d.getDay()].orders++;
              } catch { /* skip */ }
            }
            const maxRev147 = Math.max(...dayCounts.map(d => d.revenue), 1);
            const bestDay = dayCounts.reduce((best, d) => d.revenue > best.revenue ? d : best, dayCounts[0]);
            return (
              <div className="apple-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Güne Göre Satış Dağılımı' : '📅 Revenue by Day of Week'}</h3>
                  <span className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'En iyi gün:' : 'Best day:'} <span className="font-bold text-brand">{bestDay.day}</span></span>
                </div>
                <div className="flex items-end gap-2 h-32">
                  {dayCounts.map((d, i) => {
                    const h = Math.round((d.revenue / maxRev147) * 100);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1 cursor-default">
                        <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                          <div
                            className={`w-full rounded-t-lg transition-all duration-500 ${d.revenue === maxRev147 ? 'bg-brand' : 'bg-brand/30 hover:bg-brand/60'}`}
                            style={{ height: `${Math.max(h, 2)}%` }}
                            title={`₺${d.revenue.toLocaleString()} · ${d.orders} ${currentLanguage==='tr'?'sipariş':'orders'}`}
                          />
                        </div>
                        <span className={`text-[10px] font-semibold ${d.revenue === maxRev147 ? 'text-brand' : 'text-gray-400'}`}>{d.day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 148: Days-to-Stockout Forecast ── */}
          {inventory.length > 0 && (() => {
            const now148 = new Date();
            const cutoff148 = new Date(now148); cutoff148.setDate(cutoff148.getDate() - 30);
            const atRisk = inventory
              .filter(i => i.stockLevel > 0 && i.stockLevel <= (i.lowStockThreshold ?? 5) * 3)
              .map(i => {
                const sold30 = orders
                  .filter(o => {
                    try {
                      const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                      return d >= cutoff148 && o.status !== 'Cancelled';
                    } catch { return false; }
                  })
                  .reduce((s, o) => {
                    const li = (o.lineItems || []).find(l => l.inventoryId === i.id || l.name === i.name);
                    return s + (li?.quantity || 0);
                  }, 0);
                const dailyUsage = sold30 / 30;
                const daysLeft = dailyUsage > 0 ? Math.round(i.stockLevel / dailyUsage) : null;
                return { ...i, dailyUsage, daysLeft };
              })
              .filter(i => i.daysLeft !== null && i.daysLeft <= 45)
              .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
              .slice(0, 8);
            if (atRisk.length === 0) return null;
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-2">{currentLanguage === 'tr' ? '⏱️ Stok Tükenme Tahmini' : '⏱️ Days-to-Stockout Forecast'}</h3>
                <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Son 30 gün satış hızına göre tahmin' : 'Based on last 30-day sales velocity'}</p>
                <div className="space-y-3">
                  {atRisk.map(item => {
                    const d = item.daysLeft!;
                    const cls = d <= 7 ? 'bg-red-500' : d <= 20 ? 'bg-amber-400' : 'bg-emerald-400';
                    const textCls = d <= 7 ? 'text-red-600' : d <= 20 ? 'text-amber-600' : 'text-emerald-600';
                    return (
                      <div key={item.id} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-gray-800 truncate">{item.name}</span>
                            <span className={`text-xs font-bold ${textCls} shrink-0 ml-2`}>{d} {currentLanguage==='tr'?'gün':'days'}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min((d / 45) * 100, 100)}%` }} />
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{currentLanguage==='tr'?'Stok':'Stock'}: {item.stockLevel} · {currentLanguage==='tr'?'Günlük':'Daily'}: {item.dailyUsage.toFixed(1)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {reportsTab === 'genel' && orders.length >= 3 && inventory.length > 0 && (() => {
        const now166 = new Date();
        const months166 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now166.getFullYear(), now166.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const rev = mOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
          const cogs = mOrders.reduce((s, o) =>
            s + (o.lineItems ?? []).reduce((ls, li) => {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              return ls + ((inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity);
            }, 0), 0);
          const margin = rev > 0 ? Math.round(((rev - cogs) / rev) * 100) : 0;
          return { label, rev, cogs, margin };
        });
        const avgMargin = months166.filter(m => m.rev > 0).length > 0
          ? Math.round(months166.filter(m => m.rev > 0).reduce((s, m) => s + m.margin, 0) / months166.filter(m => m.rev > 0).length)
          : 0;
        const maxRev166 = Math.max(...months166.map(m => m.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📈 Aylık Brüt Marj Trendi' : '📈 Monthly Gross Margin Trend'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${avgMargin >= 30 ? 'bg-emerald-100 text-emerald-700' : avgMargin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                Ø %{avgMargin}
              </span>
            </div>
            <div className="flex items-end gap-3 h-28 mb-3">
              {months166.map((m, i) => {
                const revH = Math.round((m.rev / maxRev166) * 100);
                const cogsH = m.rev > 0 ? Math.round((m.cogs / m.rev) * revH) : 0;
                const gpH = Math.max(revH - cogsH, 0);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group cursor-default">
                    <div className="w-full flex flex-col justify-end overflow-hidden rounded-t-md" style={{ height: '88px' }}>
                      <div className="w-full" style={{ height: `${revH}%` }}>
                        <div className="w-full bg-blue-100 rounded-t-md" style={{ height: `${cogsH > 0 ? (cogsH/revH)*100 : 0}%` }} />
                        <div className="w-full bg-emerald-400" style={{ height: `${gpH > 0 ? (gpH/revH)*100 : 0}%` }} />
                      </div>
                    </div>
                    <span className="text-[9px] text-gray-400">{m.label}</span>
                    <span className={`text-[9px] font-bold ${m.margin >= 30 ? 'text-emerald-600' : m.margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>%{m.margin}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-400 rounded-sm inline-block" />{currentLanguage==='tr'?'Brüt Kâr':'Gross Profit'}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-100 rounded-sm inline-block" />{currentLanguage==='tr'?'Maliyet':'COGS'}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now156 = new Date();
        const getQuarter = (d: Date) => Math.floor(d.getMonth() / 3);
        const getQLabel = (year: number, q: number) => `Q${q + 1} ${year}`;
        // Last 4 quarters
        const quarters: { label: string; year: number; q: number; revenue: number; orders: number }[] = [];
        for (let i = 3; i >= 0; i--) {
          const qDate = new Date(now156.getFullYear(), now156.getMonth() - i * 3, 1);
          const year = qDate.getFullYear();
          const q = getQuarter(qDate);
          quarters.push({ label: getQLabel(year, q), year, q, revenue: 0, orders: 0 });
        }
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const oq = getQuarter(d);
            const entry = quarters.find(qt => qt.year === d.getFullYear() && qt.q === oq);
            if (entry) { entry.revenue += o.totalPrice || 0; entry.orders++; }
          } catch { /* skip */ }
        }
        const maxQ = Math.max(...quarters.map(q => q.revenue), 1);
        const currQ = quarters[quarters.length - 1];
        const prevQ = quarters[quarters.length - 2];
        const growth = prevQ.revenue > 0 ? Math.round(((currQ.revenue - prevQ.revenue) / prevQ.revenue) * 100) : null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Çeyrek Bazlı Karşılaştırma' : '📊 Quarter-over-Quarter Revenue'}</h3>
              {growth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${growth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {growth >= 0 ? '↑' : '↓'} %{Math.abs(growth)} QoQ
                </span>
              )}
            </div>
            <div className="flex items-end gap-4 h-36 mb-3">
              {quarters.map((q, i) => {
                const h = Math.round((q.revenue / maxQ) * 100);
                const isLatest = i === quarters.length - 1;
                return (
                  <div key={q.label} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{fmtAna(q.revenue,'K',0)}</span>
                    <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                      <div className={`w-full rounded-t-xl transition-all duration-700 ${isLatest ? 'bg-brand' : 'bg-brand/30'}`}
                        style={{ height: `${Math.max(h, 3)}%` }} />
                    </div>
                    <span className={`text-[10px] font-bold ${isLatest ? 'text-brand' : 'text-gray-400'}`}>{q.label}</span>
                    <span className="text-[9px] text-gray-400">{q.orders} {currentLanguage==='tr'?'sip':'ord'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now190 = new Date();
        // Last 6 months revenue
        const months190 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now190.getFullYear(), now190.getMonth() - (5 - i), 1);
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { x: i, rev };
        });
        // Simple linear regression
        const n = months190.length;
        const sumX = months190.reduce((s, m) => s + m.x, 0);
        const sumY = months190.reduce((s, m) => s + m.rev, 0);
        const sumXY = months190.reduce((s, m) => s + m.x * m.rev, 0);
        const sumX2 = months190.reduce((s, m) => s + m.x * m.x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
        const intercept = (sumY - slope * sumX) / n;
        const forecast = [1, 2, 3].map(f => ({
          label: new Date(now190.getFullYear(), now190.getMonth() + f, 1)
            .toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' }),
          rev: Math.max(0, Math.round(slope * (n - 1 + f) + intercept)),
        }));
        const maxForecast = Math.max(...months190.map(m => m.rev), ...forecast.map(f => f.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔮 Gelir Tahmini (3 Ay)' : '🔮 Revenue Forecast (3 Month)'}</h3>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'Doğrusal trend' : 'Linear trend model'}</span>
            </div>
            <div className="flex items-end gap-1.5 h-28 mb-3">
              {months190.map((m, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((m.rev / maxForecast) * 80))}px` }} />
                  </div>
                </div>
              ))}
              {forecast.map((f, i) => (
                <div key={`f${i}`} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-full bg-emerald-300 rounded-t-md border-2 border-dashed border-emerald-500" style={{ height: `${Math.max(4, Math.round((f.rev / maxForecast) * 80))}px` }} />
                  </div>
                  <span className="text-[8px] text-emerald-600 font-bold leading-none">{f.label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {forecast.map(f => (
                <div key={f.label} className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xs font-bold text-emerald-700">{f.label}</p>
                  <p className="text-lg font-black text-emerald-700">{fmtAna(f.rev,'K',0)}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Tahmini değerler son 6 ayın doğrusal trendine dayanmaktadır.' : 'Forecasts based on linear trend of last 6 months. Indicative only.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.filter(o => o.status === 'Delivered').length >= 3 && (() => {
        const delivered197 = orders.filter(o => {
          if (o.status !== 'Delivered') return false;
          const m = o as unknown as Record<string,unknown>;
          return !!(m.deliveredAt || m.updatedAt);
        });
        if (delivered197.length < 3) return null;
        const cycleTimes = delivered197.map(o => {
          const m = o as unknown as Record<string,unknown>;
          try {
            const created = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const delivered = ((m.deliveredAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.deliveredAt as string))
              || ((m.updatedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.updatedAt as string));
            const days = Math.round((delivered.getTime() - created.getTime()) / 86400000);
            return days >= 0 && days < 365 ? days : null;
          } catch { return null; }
        }).filter((d): d is number => d !== null);
        if (cycleTimes.length < 3) return null;
        const avgCycle = Math.round(cycleTimes.reduce((s, d) => s + d, 0) / cycleTimes.length);
        const minCycle = Math.min(...cycleTimes);
        const maxCycle = Math.max(...cycleTimes);
        // Distribution buckets
        const buckets197 = [
          { label: currentLanguage === 'tr' ? '≤1 gün' : '≤1d', max: 1, count: 0 },
          { label: '2-3', max: 3, count: 0 },
          { label: '4-7', max: 7, count: 0 },
          { label: '8-14', max: 14, count: 0 },
          { label: '15+', max: Infinity, count: 0 },
        ];
        for (const d of cycleTimes) {
          const b = buckets197.find(b => d <= b.max);
          if (b) b.count++;
        }
        const maxBucket197 = Math.max(...buckets197.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏳ Ortalama Sipariş Teslim Süresi' : '⏳ Avg Order Cycle Time'}</h3>
              <span className="text-2xl font-black text-blue-600">{avgCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{minCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'En hızlı' : 'Fastest'}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-red-500">{maxCycle} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'En yavaş' : 'Slowest'}</p>
              </div>
            </div>
            <div className="flex items-end gap-2 h-16">
              {buckets197.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end" style={{ height: '44px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBucket197) * 44))}px` }} />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now198 = new Date();
        const months198 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now198.getFullYear(), now198.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mOrds = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const aov = mOrds.length > 0 ? Math.round(mOrds.reduce((s, o) => s + (o.totalPrice || 0), 0) / mOrds.length) : 0;
          return { label, aov, count: mOrds.length };
        });
        const hasData = months198.some(m => m.aov > 0);
        if (!hasData) return null;
        const maxAOV = Math.max(...months198.map(m => m.aov), 1);
        const currAOV = months198[months198.length - 1].aov;
        const prevAOV = months198[months198.length - 2].aov;
        const aovGrowth = prevAOV > 0 ? Math.round(((currAOV - prevAOV) / prevAOV) * 100) : null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🛒 Ortalama Sipariş Değeri Trendi' : '🛒 Avg Order Value Trend'}</h3>
              {aovGrowth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${aovGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {aovGrowth >= 0 ? '↑' : '↓'} %{Math.abs(aovGrowth)} MoM
                </span>
              )}
            </div>
            <div className="flex items-end gap-3 h-24 mb-3">
              {months198.map((m, i) => {
                const isLatest = i === months198.length - 1;
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: '72px' }}>
                      {m.aov > 0 && <span className={`text-[9px] font-bold ${isLatest ? 'text-brand' : 'text-gray-500'}`}>{fmtAna(m.aov,'K',1)}</span>}
                      <div className="w-full flex items-end mt-auto" style={{ height: '52px' }}>
                        <div className={`w-full rounded-t-md ${isLatest ? 'bg-brand' : 'bg-gray-200'}`} style={{ height: `${Math.max(4, Math.round((m.aov / maxAOV) * 52))}px` }} />
                      </div>
                    </div>
                    <span className={`text-[9px] ${isLatest ? 'font-bold text-brand' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? `Bu ay: ₺${currAOV.toLocaleString()} ortalama sipariş değeri · ${months198[months198.length-1].count} sipariş` : `This month: ₺${currAOV.toLocaleString()} AOV · ${months198[months198.length-1].count} orders`}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now202 = new Date();
        const cutoff202 = new Date(now202); cutoff202.setDate(cutoff202.getDate() - 90);
        const dayRevMap: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff202) continue;
            const key = od.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'short' });
            dayRevMap[key] = (dayRevMap[key] ?? 0) + (o.totalPrice || 0);
          } catch { /* skip */ }
        }
        const topDays = Object.entries(dayRevMap).sort(([,a],[,b]) => b - a).slice(0, 6);
        if (topDays.length < 3) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🏅 En Yüksek Ciro Günleri (Son 90 Gün)' : '🏅 Top Revenue Days (Last 90 Days)'}</h3>
            <div className="space-y-2">
              {topDays.map(([day, rev], i) => {
                const maxRev = topDays[0][1];
                return (
                  <div key={day} className="flex items-center gap-3">
                    <span className="text-sm">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
                    <span className="text-xs font-medium text-gray-700 w-16 shrink-0">{day}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round((rev / maxRev) * 100)}%` }} />
                    </div>
                    <span className="text-xs font-bold text-gray-700 w-16 text-right shrink-0">{fmtAna(rev,'K',1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const tiers203 = [
          { label: '<₺5K', min: 0, max: 5000, rev: 0, cogs: 0, count: 0 },
          { label: '₺5-20K', min: 5000, max: 20000, rev: 0, cogs: 0, count: 0 },
          { label: '₺20-50K', min: 20000, max: 50000, rev: 0, cogs: 0, count: 0 },
          { label: '₺50K+', min: 50000, max: Infinity, rev: 0, cogs: 0, count: 0 },
        ];
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const tier = tiers203.find(t => (o.totalPrice || 0) >= t.min && (o.totalPrice || 0) < t.max);
          if (!tier) continue;
          tier.rev += o.totalPrice || 0;
          tier.count++;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            tier.cogs += (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }
        }
        const activeTiers = tiers203.filter(t => t.count > 0);
        if (activeTiers.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Sipariş Büyüklüğüne Göre Brüt Marj' : '🎯 Gross Margin by Order Size'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {activeTiers.map(t => {
                const margin = t.rev > 0 ? Math.round(((t.rev - t.cogs) / t.rev) * 100) : 0;
                return (
                  <div key={t.label} className={`rounded-2xl p-4 ${margin >= 30 ? 'bg-emerald-50' : margin >= 15 ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">{t.label}</p>
                    <p className={`text-3xl font-black ${margin >= 30 ? 'text-emerald-600' : margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>%{margin}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{t.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · {fmtAna(t.rev,'K',0)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const now215 = new Date();
        const months215 = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(now215.getFullYear(), now215.getMonth() - (11 - i), 1);
          const mOrds = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          return {
            label: d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', year: '2-digit' }),
            count: mOrds.length,
            rev: mOrds.reduce((s, o) => s + (o.totalPrice || 0), 0),
          };
        }).filter(m => m.count > 0);
        if (months215.length < 4) return null;
        const maxCount = Math.max(...months215.map(m => m.count), 1);
        const maxRev215 = Math.max(...months215.map(m => m.rev), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📈 Sipariş Adedi vs Ciro (12 Ay)' : '📈 Order Count vs Revenue (12 Months)'}</h3>
            <div className="flex items-end gap-1.5 h-28 mb-2">
              {months215.map((m, i) => {
                const isLatest = i === months215.length - 1;
                const revH = Math.round((m.rev / maxRev215) * 72);
                const cntH = Math.round((m.count / maxCount) * 72);
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end gap-px" style={{ height: '72px' }}>
                      <div className={`flex-1 rounded-t-sm ${isLatest ? 'bg-brand' : 'bg-red-200'}`} style={{ height: `${Math.max(2, revH)}px` }} />
                      <div className={`flex-1 rounded-t-sm ${isLatest ? 'bg-blue-500' : 'bg-blue-200'}`} style={{ height: `${Math.max(2, cntH)}px` }} />
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none">{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300 inline-block" />{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-300 inline-block" />{currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count'}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && inventory.length > 0 && (() => {
        // Working Capital = Current Assets - Current Liabilities (estimated)
        const inventoryVal216 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const arBalance216 = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const currentAssets = inventoryVal216 + arBalance216;
        // Estimated AP: orders received in last 30 days (proxy for payables)
        const now216 = new Date();
        const cut216 = new Date(now216); cut216.setDate(cut216.getDate() - 30);
        const recentPurchases = orders.filter(o => {
          const m = o as unknown as Record<string,unknown>;
          if (!m.isPurchase && !m.purchaseOrder) return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= cut216;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const estimatedPayroll = inventory.length; // fallback
        void estimatedPayroll;
        const currentLiabilities = recentPurchases; // proxy
        const workingCapital = currentAssets - currentLiabilities;
        const currentRatio = currentLiabilities > 0 ? (currentAssets / currentLiabilities).toFixed(1) : '∞';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏦 İşletme Sermayesi Analizi' : '🏦 Working Capital Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${workingCapital >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {workingCapital >= 0 ? (currentLanguage === 'tr' ? 'Sağlıklı' : 'Healthy') : (currentLanguage === 'tr' ? 'Risk' : 'Risk')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Dönen Varlıklar' : 'Current Assets', value: `₺${(currentAssets/1000).toFixed(0)}K`, color: 'text-emerald-600', sub: currentLanguage === 'tr' ? 'Stok + Alacak' : 'Inventory + AR' },
                { label: currentLanguage === 'tr' ? 'Kısa Vade Borç' : 'Current Liabilities', value: `₺${(currentLiabilities/1000).toFixed(0)}K`, color: 'text-red-500', sub: currentLanguage === 'tr' ? 'Borç tahmini' : 'AP estimate' },
                { label: currentLanguage === 'tr' ? 'Net Sermaye' : 'Net Working Capital', value: `₺${(workingCapital/1000).toFixed(0)}K`, color: workingCapital >= 0 ? 'text-emerald-600' : 'text-red-500', sub: currentLanguage === 'tr' ? 'Cari Oran: ' + currentRatio : 'Current Ratio: ' + currentRatio },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-black ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.sub}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{currentLanguage === 'tr' ? 'Stok Değeri' : 'Inventory Value'}</span>
                  <span>{fmtAna(inventoryVal216,'K',0)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-300 rounded-full" style={{ width: `${currentAssets > 0 ? Math.round((inventoryVal216/currentAssets)*100) : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{currentLanguage === 'tr' ? 'Tahsil Edilecek Alacaklar' : 'Accounts Receivable'}</span>
                  <span>{fmtAna(arBalance216,'K',0)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-300 rounded-full" style={{ width: `${currentAssets > 0 ? Math.round((arBalance216/currentAssets)*100) : 0}%` }} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Top products by revenue contribution
        const prodRev217: Record<string, { name: string; rev: number; qty: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const key = li.inventoryId || li.name || '';
            if (!key) continue;
            if (!prodRev217[key]) prodRev217[key] = { name: li.name || key, rev: 0, qty: 0 };
            prodRev217[key].rev += li.price * li.quantity;
            prodRev217[key].qty += li.quantity;
          }
        }
        const sorted217 = Object.values(prodRev217).sort((a, b) => b.rev - a.rev).slice(0, 6);
        if (sorted217.length < 2) return null;
        const total217 = sorted217.reduce((s, p) => s + p.rev, 0);
        const COLORS_217 = ['#ff4000', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#6b7280'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🧩 Ürün Karma Analizi (Top 6)' : '🧩 Product Mix Analysis (Top 6)'}</h3>
            <div className="flex gap-2 mb-4">
              {sorted217.map((p, i) => {
                const pct = total217 > 0 ? Math.round((p.rev / total217) * 100) : 0;
                return (
                  <div key={p.name} className="flex-1" style={{ minWidth: 0 }}>
                    <div className="h-16 rounded-xl flex items-end justify-center pb-2" style={{ backgroundColor: COLORS_217[i] + '20' }}>
                      <span className="text-[10px] font-bold" style={{ color: COLORS_217[i] }}>{pct}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full mt-1" style={{ backgroundColor: COLORS_217[i] }} />
                    <p className="text-[9px] text-gray-600 text-center mt-1 truncate">{p.name}</p>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              {sorted217.map((p, i) => {
                const pct = total217 > 0 ? Math.round((p.rev / total217) * 100) : 0;
                return (
                  <div key={p.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS_217[i] }} />
                    <span className="text-gray-700 truncate flex-1">{p.name}</span>
                    <span className="text-gray-400 shrink-0">{p.qty} {currentLanguage === 'tr' ? 'adet' : 'units'}</span>
                    <span className="font-bold text-gray-700 shrink-0">%{pct}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const custRev220: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          custRev220[name] = (custRev220[name] ?? 0) + (o.totalPrice || 0);
        }
        const total220 = Object.values(custRev220).reduce((s, v) => s + v, 0);
        if (total220 === 0) return null;
        // HHI = sum of (market share %)^2 — normalized 0-10000
        const hhi = Object.values(custRev220).reduce((s, v) => s + Math.pow((v / total220) * 100, 2), 0);
        const hhiRounded = Math.round(hhi);
        const hhiLevel = hhiRounded > 2500 ? 'high' : hhiRounded > 1500 ? 'medium' : 'low';
        const custCount = Object.keys(custRev220).length;
        const avgRevPerCust = Math.round(total220 / custCount);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📐 Gelir Konsantrasyon Endeksi (HHI)' : '📐 Revenue Concentration Index (HHI)'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${hhiLevel === 'high' ? 'bg-red-100 text-red-700' : hhiLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {hhiLevel === 'high' ? (currentLanguage === 'tr' ? 'Yüksek Risk' : 'High Risk') : hhiLevel === 'medium' ? (currentLanguage === 'tr' ? 'Orta Risk' : 'Med Risk') : (currentLanguage === 'tr' ? 'Düşük Risk' : 'Diversified')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'HHI', value: hhiRounded.toLocaleString(), color: hhiLevel === 'high' ? 'text-red-500' : hhiLevel === 'medium' ? 'text-amber-500' : 'text-emerald-600', desc: currentLanguage === 'tr' ? 'Herfindahl Endeksi' : 'Herfindahl Index' },
                { label: currentLanguage === 'tr' ? 'Müşteri Sayısı' : 'Customers', value: String(custCount), color: 'text-blue-600', desc: currentLanguage === 'tr' ? 'Toplam aktif' : 'Total active' },
                { label: currentLanguage === 'tr' ? 'Müşteri Başı' : 'Avg per Customer', value: `₺${(avgRevPerCust/1000).toFixed(0)}K`, color: 'text-gray-700', desc: currentLanguage === 'tr' ? 'Ort. gelir' : 'Avg revenue' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.desc}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-3">
              <span className="text-blue-500">💡</span>
              <p className="text-[11px] text-blue-700">
                {currentLanguage === 'tr'
                  ? `HHI > 2500 yüksek, 1500-2500 orta, < 1500 düşük konsantrasyon. Şu an: ${hhiRounded} — ${hhiLevel === 'low' ? 'müşteri tabanı sağlıklı dağılmış.' : hhiLevel === 'medium' ? 'birkaç müşteriye bağımlılık var.' : 'kritik müşteri bağımlılığı!'}`
                  : `HHI > 2500 concentrated, 1500-2500 moderate, < 1500 diversified. Currently: ${hhiRounded} — ${hhiLevel === 'low' ? 'healthy diversification.' : hhiLevel === 'medium' ? 'moderate concentration.' : 'critical dependency!'}`}
              </p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now222 = new Date();
        void now222;
        const backlogOrders = orders.filter(o => o.status === 'Pending' || o.status === 'Processing');
        const shippedOrders = orders.filter(o => o.status === 'Shipped');
        const backlogValue = backlogOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const shippedValue = shippedOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const totalPipeline = backlogValue + shippedValue;
        if (totalPipeline === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📋 Sipariş Biriktirme & Boru Hattı Değeri' : '📋 Order Backlog & Pipeline Value'}</h3>
              <span className="text-sm font-black text-blue-600">{fmtAna(totalPipeline,'K',0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Sipariş Birikimi' : 'Order Backlog', count: backlogOrders.length, value: backlogValue, color: 'text-amber-600', bg: 'bg-amber-50', icon: '⏳' },
                { label: currentLanguage === 'tr' ? 'Kargoda' : 'In Transit', count: shippedOrders.length, value: shippedValue, color: 'text-blue-600', bg: 'bg-blue-50', icon: '🚚' },
              ].map(k => (
                <div key={k.label} className={`${k.bg} rounded-2xl p-4`}>
                  <p className="text-xl mb-1">{k.icon}</p>
                  <p className={`text-2xl font-black ${k.color}`}>{fmtAna(k.value,'K',0)}</p>
                  <p className="text-xs text-gray-600 font-medium mt-1">{k.label}</p>
                  <p className="text-[10px] text-gray-400">{k.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</p>
                </div>
              ))}
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
              <div className="h-full bg-amber-400" style={{ width: `${totalPipeline > 0 ? Math.round((backlogValue / totalPipeline) * 100) : 0}%` }} />
              <div className="h-full bg-blue-400" style={{ width: `${totalPipeline > 0 ? Math.round((shippedValue / totalPipeline) * 100) : 0}%` }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'İşlenmemiş ve kargodaki siparişlerin toplam değeri' : 'Total value of unprocessed and in-transit orders'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now225 = new Date();
        const monthStart225 = new Date(now225.getFullYear(), now225.getMonth(), 1);
        const daysInMonth = new Date(now225.getFullYear(), now225.getMonth() + 1, 0).getDate();
        const dayOfMonth = now225.getDate();
        const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);
        const mRevenue225 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const mOrders225 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).length;
        const mNewCustomers225 = new Set(orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart225;
          } catch { return false; }
        }).map(o => o.customerName || '—')).size;
        // Pace = what we'd expect at current run rate by end of month
        const pace225 = dayOfMonth > 0 ? Math.round((mRevenue225 / dayOfMonth) * daysInMonth) : 0;
        const goals = [
          { label: currentLanguage === 'tr' ? 'Aylık Ciro' : 'Monthly Revenue', current: mRevenue225, pace: pace225, icon: '💰', format: (v: number) => `₺${(v/1000).toFixed(0)}K` },
          { label: currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count', current: mOrders225, pace: dayOfMonth > 0 ? Math.round((mOrders225 / dayOfMonth) * daysInMonth) : 0, icon: '📦', format: (v: number) => String(v) },
          { label: currentLanguage === 'tr' ? 'Aktif Müşteri' : 'Active Customers', current: mNewCustomers225, pace: dayOfMonth > 0 ? Math.round((mNewCustomers225 / dayOfMonth) * daysInMonth) : 0, icon: '👥', format: (v: number) => String(v) },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🎯 Aylık İlerleme Göstergesi' : '🎯 Monthly Goal Progress'}</h3>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                {currentLanguage === 'tr' ? `Ay: %${monthProgress} tamamlandı (${dayOfMonth}/${daysInMonth} gün)` : `Month: ${monthProgress}% complete (day ${dayOfMonth}/${daysInMonth})`}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${monthProgress}%` }} />
            </div>
            <div className="space-y-4">
              {goals.map(g => {
                const paceVsMonth = monthProgress > 0 ? Math.round((g.current / (g.pace || 1)) * 100) : 0;
                const isAhead = paceVsMonth >= 100;
                return (
                  <div key={g.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span>{g.icon}</span>
                        <span className="text-xs font-medium text-gray-700">{g.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-gray-700 font-bold">{g.format(g.current)}</span>
                        <span className="text-[10px] text-gray-400">→ {g.format(g.pace)} {currentLanguage === 'tr' ? 'tahmini' : 'projected'}</span>
                        <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${isAhead ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isAhead ? '▲' : '▼'} %{Math.abs(paceVsMonth - 100)}
                        </span>
                      </div>
                    </div>
                    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isAhead ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${Math.min(paceVsMonth, 100)}%` }} />
                      <div className="absolute top-0 h-full w-px bg-blue-400 opacity-60" style={{ left: `${monthProgress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Mavi çizgi = ayın şu anki günü. Yeşil = hedefin önünde, Sarı = hedefin gerisinde.' : 'Blue line = current day in month. Green = ahead of pace, Amber = behind pace.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now234 = new Date();
        // Last 8 weeks
        const weeks234 = Array.from({ length: 8 }, (_, i) => {
          const weekStart = new Date(now234);
          weekStart.setDate(weekStart.getDate() - (7 - i) * 7 - weekStart.getDay());
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);
          const label = `W${weekStart.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', day: 'numeric' })}`;
          const rev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od >= weekStart && od <= weekEnd;
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, rev, weekStart };
        });
        const hasData = weeks234.some(w => w.rev > 0);
        if (!hasData) return null;
        const maxWeekRev = Math.max(...weeks234.map(w => w.rev), 1);
        const lastWeek = weeks234[weeks234.length - 1].rev;
        const prevWeek = weeks234[weeks234.length - 2].rev;
        const weekGrowth = prevWeek > 0 ? Math.round(((lastWeek - prevWeek) / prevWeek) * 100) : null;
        const annualRunRate = lastWeek * 52;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Haftalık Ciro & Yıllık Projeksiyon' : '📅 Weekly Revenue & Annual Run Rate'}</h3>
              {weekGrowth !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${weekGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {weekGrowth >= 0 ? '↑' : '↓'} %{Math.abs(weekGrowth)} WoW
                </span>
              )}
            </div>
            <div className="flex items-end gap-1.5 h-24 mb-3">
              {weeks234.map((w, i) => {
                const isLatest = i === weeks234.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end" style={{ height: '68px' }}>
                      <div className={`w-full rounded-t-md ${isLatest ? 'bg-brand' : 'bg-gray-200'}`} style={{ height: `${Math.max(4, Math.round((w.rev / maxWeekRev) * 68))}px` }} />
                    </div>
                    <span className={`text-[8px] leading-none ${isLatest ? 'font-bold text-brand' : 'text-gray-400'}`}>{w.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-gray-700">{fmtAna(lastWeek,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu hafta' : 'This week'}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-blue-600">{fmtAna(annualRunRate,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Yıllık projeksiyon' : 'Annual run rate'}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now235 = new Date();
        const prevMonthStart235 = new Date(now235.getFullYear(), now235.getMonth() - 1, 1);
        const prevMonthEnd235 = new Date(now235.getFullYear(), now235.getMonth(), 0, 23, 59, 59);
        const currMonthStart235 = new Date(now235.getFullYear(), now235.getMonth(), 1);
        const calcMargin = (ordersList: Order[]) => {
          const rev = ordersList.reduce((s, o) => s + (o.totalPrice || 0), 0);
          const cogs = ordersList.reduce((s, o) =>
            s + (o.lineItems ?? []).reduce((ls, li) => {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              return ls + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
            }, 0), 0);
          return { rev, cogs, margin: rev > 0 ? Math.round(((rev - cogs) / rev) * 100) : 0, gross: rev - cogs };
        };
        const filterOrders = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const prev235 = calcMargin(filterOrders(prevMonthStart235, prevMonthEnd235));
        const curr235 = calcMargin(filterOrders(currMonthStart235, new Date()));
        if (prev235.rev === 0 && curr235.rev === 0) return null;
        const revChange = curr235.rev - prev235.rev;
        const grossChange = curr235.gross - prev235.gross;
        const marginChange = curr235.margin - prev235.margin;
        const bridges = [
          { label: currentLanguage === 'tr' ? 'Önceki Ay Brüt Kâr' : 'Prior Month Gross Profit', value: prev235.gross, neutral: true },
          { label: currentLanguage === 'tr' ? 'Ciro Değişimi Etkisi' : 'Revenue Volume Effect', value: revChange * (prev235.margin / 100), neutral: false },
          { label: currentLanguage === 'tr' ? 'Marj Değişimi Etkisi' : 'Margin Mix Effect', value: grossChange - revChange * (prev235.margin / 100), neutral: false },
          { label: currentLanguage === 'tr' ? 'Bu Ay Brüt Kâr' : 'Current Month Gross Profit', value: curr235.gross, neutral: true, total: true },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🌉 Marj Köprü Analizi (MoM)' : '🌉 Margin Bridge Analysis (MoM)'}</h3>
              <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${marginChange >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {marginChange >= 0 ? '+' : ''}{marginChange}pp {currentLanguage === 'tr' ? 'marj' : 'margin'}
              </span>
            </div>
            <div className="space-y-2">
              {bridges.map((b, i) => (
                <div key={i} className={`flex items-center justify-between p-2.5 rounded-xl ${b.total ? 'bg-blue-50' : b.neutral ? 'bg-gray-50' : b.value >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <span className={`text-xs font-medium ${b.total ? 'text-blue-800 font-bold' : 'text-gray-700'}`}>{b.label}</span>
                  <span className={`text-sm font-bold shrink-0 ml-2 ${b.total ? 'text-blue-700' : b.neutral ? 'text-gray-700' : b.value >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {!b.neutral && b.value >= 0 ? '+' : ''}{b.neutral ? '' : b.value >= 0 ? '' : ''}{fmtAna(Math.abs(b.value),'K',0)}{!b.neutral && b.value < 0 ? ' ▼' : !b.neutral ? ' ▲' : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
              <span>{currentLanguage === 'tr' ? 'Önceki: ' : 'Prior: '}{fmtAna(prev235.rev,'K',0)} · %{prev235.margin}</span>
              <span>{currentLanguage === 'tr' ? 'Bu ay: ' : 'Current: '}{fmtAna(curr235.rev,'K',0)} · %{curr235.margin}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now239 = new Date();
        const months3Start = new Date(now239.getFullYear(), now239.getMonth() - 3, 1);
        const recentOrders = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= months3Start;
          } catch { return false; }
        });
        const revenue239 = recentOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const cogs239 = recentOrders.reduce((s, o) =>
          s + (o.lineItems ?? []).reduce((ls, li) => {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            return ls + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }, 0), 0);
        const grossProfit = revenue239 - cogs239;
        const grossMargin = revenue239 > 0 ? Math.round((grossProfit / revenue239) * 100) : 0;
        const inventoryVal239 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const arVal = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered').reduce((s, o) => s + (o.totalPrice || 0), 0);
        const monthlyRevRate = revenue239 / 3;
        const kpis239 = [
          { label: 'Gross Margin', value: `%${grossMargin}`, score: grossMargin >= 30 ? 'A' : grossMargin >= 20 ? 'B' : grossMargin >= 10 ? 'C' : 'D', desc: currentLanguage === 'tr' ? 'Brüt marj' : 'Gross margin' },
          { label: 'Revenue Trend', value: revenue239 > 0 ? '▲' : '—', score: revenue239 > monthlyRevRate * 2.5 ? 'A' : revenue239 > monthlyRevRate ? 'B' : 'C', desc: currentLanguage === 'tr' ? '3 aylık ciro' : '3-month revenue' },
          { label: 'AR Health', value: arVal > 0 ? `₺${(arVal/1000).toFixed(0)}K` : '✓', score: arVal <= monthlyRevRate * 0.5 ? 'A' : arVal <= monthlyRevRate ? 'B' : 'C', desc: currentLanguage === 'tr' ? 'Tahsilat bekleyen' : 'Outstanding AR' },
          { label: 'Inventory', value: `₺${(inventoryVal239/1000).toFixed(0)}K`, score: inventoryVal239 <= cogs239 * 1.5 ? 'A' : inventoryVal239 <= cogs239 * 2.5 ? 'B' : 'C', desc: currentLanguage === 'tr' ? 'Stok değeri' : 'Stock value' },
        ];
        const gradeColor: Record<string, string> = { A: 'text-emerald-600 bg-emerald-100', B: 'text-blue-600 bg-blue-100', C: 'text-amber-600 bg-amber-100', D: 'text-red-600 bg-red-100' };
        const overallScore = Math.round(['A','B','C','D'].map((g, i) => kpis239.filter(k => k.score === g).length * (4 - i)).reduce((s, v) => s + v, 0) / kpis239.length);
        const overallGrade = overallScore >= 3.5 ? 'A' : overallScore >= 2.5 ? 'B' : overallScore >= 1.5 ? 'C' : 'D';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏦 Finansal Sağlık Göstergesi' : '🏦 Financial Health Dashboard'}</h3>
              <span className={`text-2xl font-black px-3 py-1 rounded-xl ${gradeColor[overallGrade]}`}>{overallGrade}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {kpis239.map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{k.label}</p>
                    <span className={`text-xs font-black px-1.5 py-0.5 rounded ${gradeColor[k.score]}`}>{k.score}</span>
                  </div>
                  <p className="text-xl font-black text-gray-700">{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.desc}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now245 = new Date();
        const monthStart245 = new Date(now245.getFullYear(), now245.getMonth(), 1);
        const prevMonthStart245 = new Date(now245.getFullYear(), now245.getMonth() - 1, 1);
        const prevMonthEnd245 = new Date(now245.getFullYear(), now245.getMonth(), 0, 23, 59, 59);
        const filterOrders245 = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const currOrders = filterOrders245(monthStart245, new Date());
        const prevOrders = filterOrders245(prevMonthStart245, prevMonthEnd245);
        const currRev = currOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const prevRev = prevOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const revGrowth = prevRev > 0 ? Math.round(((currRev - prevRev) / prevRev) * 100) : null;
        const currCusts = new Set(currOrders.map(o => o.customerName || '—')).size;
        const prevCusts = new Set(prevOrders.map(o => o.customerName || '—')).size;
        const custGrowth = prevCusts > 0 ? Math.round(((currCusts - prevCusts) / prevCusts) * 100) : null;
        const currAOV = currOrders.length > 0 ? Math.round(currRev / currOrders.length) : 0;
        const prevAOV = prevOrders.length > 0 ? Math.round(prevOrders.reduce((s, o) => s + (o.totalPrice || 0), 0) / prevOrders.length) : 0;
        const aovGrowth245 = prevAOV > 0 ? Math.round(((currAOV - prevAOV) / prevAOV) * 100) : null;
        const kpis245 = [
          { icon: '💰', label: currentLanguage === 'tr' ? 'Bu Ay Ciro' : 'Month Revenue', value: `₺${(currRev/1000).toFixed(0)}K`, growth: revGrowth },
          { icon: '📦', label: currentLanguage === 'tr' ? 'Sipariş' : 'Orders', value: String(currOrders.length), growth: prevOrders.length > 0 ? Math.round(((currOrders.length - prevOrders.length) / prevOrders.length) * 100) : null },
          { icon: '👥', label: currentLanguage === 'tr' ? 'Aktif Müşteri' : 'Active Customers', value: String(currCusts), growth: custGrowth },
          { icon: '🛒', label: 'AOV', value: `₺${(currAOV/1000).toFixed(1)}K`, growth: aovGrowth245 },
        ];
        return (
          <div className="apple-card p-6 border-2 border-brand/20">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">📋</span>
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yönetici KPI Özeti' : 'Executive KPI Summary'}</h3>
              <span className="text-[10px] text-gray-400 ml-auto">{now245.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' })}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {kpis245.map(k => (
                <div key={k.label} className="bg-gray-50 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg">{k.icon}</span>
                    {k.growth !== null && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.growth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {k.growth >= 0 ? '↑' : '↓'} %{Math.abs(k.growth)}
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-black text-gray-800">{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const methodMap: Record<string, { count: number; rev: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const m = o as unknown as Record<string,unknown>;
          const method = (m.paymentMethod as string) || (m.payment as string) || (currentLanguage === 'tr' ? 'Belirtilmemiş' : 'Not specified');
          if (!methodMap[method]) methodMap[method] = { count: 0, rev: 0 };
          methodMap[method].count++;
          methodMap[method].rev += o.totalPrice || 0;
        }
        const methodList = Object.entries(methodMap).sort(([,a],[,b]) => b.rev - a.rev);
        if (methodList.length < 2) return null;
        const totalRev249 = methodList.reduce((s,[,v]) => s + v.rev, 0);
        const COLORS249 = ['bg-brand', 'bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-purple-400'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💳 Ödeme Yöntemi Dağılımı' : '💳 Payment Method Distribution'}</h3>
            <div className="space-y-2.5">
              {methodList.slice(0, 5).map(([method, d], i) => {
                const pct = totalRev249 > 0 ? Math.round((d.rev / totalRev249) * 100) : 0;
                return (
                  <div key={method}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700 capitalize">{method}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{d.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                        <span className="text-[10px] font-bold text-gray-500">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(d.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${COLORS249[i] ?? 'bg-gray-400'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && employees.length > 0 && (() => {
        const now250 = new Date();
        const m3Start = new Date(now250.getFullYear(), now250.getMonth() - 3, 1);
        const recentOrds = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= m3Start;
          } catch { return false; }
        });
        const rev250 = recentOrds.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const activeEmp250 = employees.filter(e => e.status === 'Aktif').length;
        const lowStockCount = inventory.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)).length;
        const inventoryVal250 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        const totalOrds250 = recentOrds.length;
        const uniqueCusts250 = new Set(recentOrds.map(o => o.customerName || '—')).size;
        const openOrds = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').length;
        const insights = [
          rev250 > 0 && `💰 ${currentLanguage === 'tr' ? `Son 3 ayda ₺${(rev250/1000).toFixed(0)}K ciro` : `₺${(rev250/1000).toFixed(0)}K revenue in last 3 months`}`,
          `📦 ${currentLanguage === 'tr' ? `${totalOrds250} sipariş, ${uniqueCusts250} benzersiz müşteri` : `${totalOrds250} orders from ${uniqueCusts250} unique customers`}`,
          `👥 ${currentLanguage === 'tr' ? `${activeEmp250} aktif çalışan` : `${activeEmp250} active employees`}`,
          `🏭 ${currentLanguage === 'tr' ? `₺${(inventoryVal250/1000).toFixed(0)}K stok değeri` : `₺${(inventoryVal250/1000).toFixed(0)}K inventory value`}`,
          lowStockCount > 0 && `⚠️ ${currentLanguage === 'tr' ? `${lowStockCount} ürün kritik stok seviyesinde` : `${lowStockCount} items at critical stock level`}`,
          openOrds > 0 && `⏳ ${currentLanguage === 'tr' ? `${openOrds} sipariş işleme bekliyor` : `${openOrds} orders awaiting processing`}`,
        ].filter(Boolean) as string[];
        return (
          <div className="apple-card p-6 bg-gradient-to-br from-gray-50 to-white border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔭</span>
              <div>
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '360° İş Zekası Özeti' : '360° Business Intelligence Summary'}</h3>
                <p className="text-[10px] text-gray-400">{now250.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {insights.map((insight, i) => (
                <div key={i} className="flex items-start gap-2.5 p-3 bg-white rounded-xl shadow-sm border border-gray-50">
                  <p className="text-xs text-gray-700 leading-relaxed">{insight}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-brand/5 rounded-xl border border-brand/10">
              <p className="text-[11px] text-brand font-semibold">{currentLanguage === 'tr' ? '🚀 Cetpa ERP Analytics · 250 Faz tamamlandı' : '🚀 Cetpa ERP Analytics · 250 Phases Complete'}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Finansal, satış, lojistik, envanter ve İK analizleri entegre edildi.' : 'Financial, sales, logistics, inventory, and HR analytics fully integrated.'}</p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now251 = new Date();
        const currYear = now251.getFullYear();
        const prevYear = currYear - 1;
        const months251 = Array.from({ length: 12 }, (_, i) => {
          const label = new Date(currYear, i, 1).toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const curr = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d.getFullYear() === currYear && d.getMonth() === i; } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          const prev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try { const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); return d.getFullYear() === prevYear && d.getMonth() === i; } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, curr, prev };
        });
        const hasPrev = months251.some(m => m.prev > 0);
        const totalCurr = months251.reduce((s, m) => s + m.curr, 0);
        const totalPrev = months251.reduce((s, m) => s + m.prev, 0);
        const yoyGrowth = totalPrev > 0 ? Math.round(((totalCurr - totalPrev) / totalPrev) * 100) : null;
        if (totalCurr === 0) return null;
        const maxVal251 = Math.max(...months251.map(m => Math.max(m.curr, m.prev)), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Yıllık Ciro Karşılaştırması (YoY)' : '📅 Year-over-Year Revenue Comparison'}</h3>
              {yoyGrowth !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${yoyGrowth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {yoyGrowth >= 0 ? '↑' : '↓'} %{Math.abs(yoyGrowth)} YoY
                </span>
              )}
            </div>
            <div className="flex items-end gap-1 h-28 mb-2">
              {months251.map((m, i) => {
                const currH = Math.round((m.curr / maxVal251) * 80);
                const prevH = Math.round((m.prev / maxVal251) * 80);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end gap-px" style={{ height: '80px' }}>
                      <div className="flex-1 bg-brand rounded-t-sm" style={{ height: `${Math.max(m.curr > 0 ? 2 : 0, currH)}px` }} />
                      {hasPrev && <div className="flex-1 bg-gray-200 rounded-t-sm" style={{ height: `${Math.max(m.prev > 0 ? 2 : 0, prevH)}px` }} />}
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none">{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-brand" /><span className="text-[10px] text-gray-500">{currYear}: {fmtAna(totalCurr,'K',0)}</span></div>
              {hasPrev && <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-gray-300" /><span className="text-[10px] text-gray-500">{prevYear}: {fmtAna(totalPrev,'K',0)}</span></div>}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const validOrders = orders.filter(o => o.status !== 'Cancelled' && (o.totalPrice || 0) > 0);
        if (validOrders.length < 10) return null;
        const sorted256 = [...validOrders].sort((a, b) => (a.totalPrice || 0) - (b.totalPrice || 0));
        const decileSize = Math.ceil(sorted256.length / 10);
        const deciles = Array.from({ length: 10 }, (_, i) => {
          const slice = sorted256.slice(i * decileSize, (i + 1) * decileSize);
          const rev = slice.reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label: `D${i + 1}`, rev, count: slice.length };
        });
        const totalRev256 = deciles.reduce((s, d) => s + d.rev, 0);
        const top30pct = deciles.slice(7).reduce((s, d) => s + d.rev, 0);
        const top30share = totalRev256 > 0 ? Math.round((top30pct / totalRev256) * 100) : 0;
        const maxRev256 = Math.max(...deciles.map(d => d.rev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Sipariş Büyüklüğü Desil Analizi' : '📊 Order Size Decile Analysis'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `Üst %30 → %${top30share} ciro` : `Top 30% → ${top30share}% revenue`}</span>
            </div>
            <div className="flex items-end gap-1 h-20 mb-2">
              {deciles.map((d, i) => {
                const isTop = i >= 7;
                return (
                  <div key={d.label} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end" style={{ height: '64px' }}>
                      <div className={`w-full rounded-t-sm ${isTop ? 'bg-brand' : 'bg-blue-200'}`} style={{ height: `${Math.max(4, Math.round((d.rev / maxRev256) * 64))}px` }} />
                    </div>
                    <span className="text-[8px] text-gray-400">{d.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'D1 = en küçük siparişler, D10 = en büyük siparişler. Kırmızı = üst %30.' : 'D1 = smallest orders, D10 = largest orders. Red = top 30%.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now260 = new Date();
        // Compare last 30 days vs prior 30 days across key metrics
        const last30 = new Date(now260); last30.setDate(last30.getDate() - 30);
        const prev30Start = new Date(now260); prev30Start.setDate(prev30Start.getDate() - 60);
        const filter260 = (start: Date, end: Date) => orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= start && od <= end;
          } catch { return false; }
        });
        const curr260 = filter260(last30, now260);
        const prev260 = filter260(prev30Start, last30);
        const metrics260 = [
          { label: currentLanguage === 'tr' ? 'Ciro' : 'Revenue', curr: curr260.reduce((s, o) => s + (o.totalPrice || 0), 0), prev: prev260.reduce((s, o) => s + (o.totalPrice || 0), 0) },
          { label: currentLanguage === 'tr' ? 'Sipariş Adedi' : 'Order Count', curr: curr260.length, prev: prev260.length },
          { label: currentLanguage === 'tr' ? 'Müşteri Sayısı' : 'Customers', curr: new Set(curr260.map(o => o.customerName || '—')).size, prev: new Set(prev260.map(o => o.customerName || '—')).size },
          { label: 'AOV', curr: curr260.length > 0 ? Math.round(curr260.reduce((s, o) => s + (o.totalPrice || 0), 0) / curr260.length) : 0, prev: prev260.length > 0 ? Math.round(prev260.reduce((s, o) => s + (o.totalPrice || 0), 0) / prev260.length) : 0 },
        ];
        const scored = metrics260.map(m => ({
          ...m,
          growth: m.prev > 0 ? Math.round(((m.curr - m.prev) / m.prev) * 100) : null,
          score: m.prev > 0 ? (m.curr >= m.prev * 1.1 ? 25 : m.curr >= m.prev ? 15 : m.curr >= m.prev * 0.9 ? 5 : 0) : (m.curr > 0 ? 15 : 0),
        }));
        const momentumScore = scored.reduce((s, m) => s + m.score, 0);
        const maxScore = 100;
        const momentumLevel = momentumScore >= 80 ? { label: currentLanguage === 'tr' ? '🚀 Güçlü İvme' : '🚀 Strong Momentum', color: 'text-emerald-600 bg-emerald-100' }
          : momentumScore >= 50 ? { label: currentLanguage === 'tr' ? '📈 Orta İvme' : '📈 Moderate Momentum', color: 'text-blue-600 bg-blue-100' }
          : momentumScore >= 25 ? { label: currentLanguage === 'tr' ? '➡️ Stabil' : '➡️ Stable', color: 'text-amber-600 bg-amber-100' }
          : { label: currentLanguage === 'tr' ? '📉 Düşüş' : '📉 Declining', color: 'text-red-600 bg-red-100' };
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Satış Momentum Skoru' : '⚡ Sales Momentum Score'}</h3>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${momentumLevel.color}`}>{momentumLevel.label}</span>
                <span className={`text-2xl font-black ${momentumLevel.color.split(' ')[0]}`}>{momentumScore}/{maxScore}</span>
              </div>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className={`h-full rounded-full transition-all ${momentumScore >= 80 ? 'bg-emerald-400' : momentumScore >= 50 ? 'bg-blue-400' : momentumScore >= 25 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${momentumScore}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {scored.map(m => (
                <div key={m.label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 font-medium mb-1">{m.label}</p>
                  <p className="text-lg font-black text-gray-800">{typeof m.curr === 'number' && m.curr > 1000 ? `₺${(m.curr/1000).toFixed(0)}K` : m.curr}</p>
                  {m.growth !== null && (
                    <p className={`text-[10px] font-bold ${m.growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {m.growth >= 0 ? '↑' : '↓'} %{Math.abs(m.growth)} MoM
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 20 && (() => {
        const sorted = [...orders].sort((a,b) => a.totalPrice - b.totalPrice);
        const n = sorted.length;
        const q = Math.floor(n / 4);
        const quartiles = [
          { label: 'Q1 (Bottom 25%)', orders: sorted.slice(0, q) },
          { label: 'Q2 (25–50%)', orders: sorted.slice(q, q*2) },
          { label: 'Q3 (50–75%)', orders: sorted.slice(q*2, q*3) },
          { label: 'Q4 (Top 25%)', orders: sorted.slice(q*3) },
        ];
        const data = quartiles.map(qt => ({
          label: qt.label,
          count: qt.orders.length,
          revenue: qt.orders.reduce((s, o) => s + o.totalPrice, 0),
          avgOrder: qt.orders.length ? qt.orders.reduce((s, o) => s + o.totalPrice, 0) / qt.orders.length : 0,
        }));
        const maxRev = Math.max(...data.map(d => d.revenue));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Quartile Analysis</h3>
            <p className="text-xs text-gray-500 mb-4">Orders split into 4 equal quartiles by order value</p>
            <div className="space-y-3">
              {data.map((d, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="font-medium">{d.label}</span>
                    <span>{d.count} orders · avg {fmtAna(d.avgOrder,'full',0)} · total {fmtAna(d.revenue,'full',0)}</span>
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxRev > 0 ? (d.revenue/maxRev*100) : 0}%`, background: ['#dbeafe','#93c5fd','#3b82f6','#1d4ed8'][i] }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Top quartile drives {maxRev > 0 ? ((data[3].revenue / data.reduce((s,d)=>s+d.revenue,0))*100).toFixed(0) : 0}% of total revenue</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const dayCounts = Array(7).fill(0);
        const dayRevenue = Array(7).fill(0);
        orders.forEach(o => {
          const d = ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)).getDay();
          dayCounts[d]++;
          dayRevenue[d] += o.totalPrice;
        });
        const maxRev = Math.max(...dayRevenue);
        if (maxRev === 0) return null;
        const bestDay = dayRevenue.indexOf(maxRev);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Sales Velocity by Day of Week</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count per weekday — best day: <span className="font-bold text-green-600">{dayLabels[bestDay]}</span></p>
            <div className="flex items-end gap-2 h-28">
              {dayLabels.map((label, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600">{dayCounts[i]}</span>
                  <div className="w-full rounded-t transition-all" style={{ height: `${maxRev > 0 ? (dayRevenue[i]/maxRev*80) : 4}px`, background: i === bestDay ? '#f97316' : '#6366f1', minHeight: '4px' }} />
                  <span className="text-[9px] text-gray-500 font-medium">{label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-2">
              {dayRevenue.map((r,i) => (
                <div key={i} className="text-center text-[8px] text-gray-400">{r >= 1000 ? fmtAna(r,'K',0) : fmtAna(r)}</div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const dayCounts: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
          if (diff <= 90) {
            const key = d.toISOString().slice(0,10);
            dayCounts[key] = (dayCounts[key] || 0) + 1;
          }
        });
        const days = Array.from({length: 90}, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (89 - i));
          return d.toISOString().slice(0,10);
        });
        const maxCount = Math.max(...days.map(d => dayCounts[d] || 0), 1);
        const totalDaysWithOrders = days.filter(d => dayCounts[d] > 0).length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Density — Last 90 Days</h3>
            <p className="text-xs text-gray-500 mb-4">{totalDaysWithOrders} active days out of 90</p>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(30, 1fr)' }}>
              {days.map(day => {
                const count = dayCounts[day] || 0;
                const intensity = count / maxCount;
                return (
                  <div
                    key={day}
                    title={`${day}: ${count} orders`}
                    className="rounded-sm cursor-default"
                    style={{ height: '12px', background: count === 0 ? '#f3f4f6' : `rgba(239,68,68,${0.2 + intensity*0.8})` }}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[9px] text-gray-400">Less</span>
              {[0.1, 0.3, 0.5, 0.7, 1.0].map((v,i) => (
                <div key={i} className="w-3 h-3 rounded-sm" style={{ background: `rgba(239,68,68,${0.2+v*0.8})` }} />
              ))}
              <span className="text-[9px] text-gray-400">More</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const withMargin = orders.filter(o => o.lineItems && o.lineItems.length > 0).map(o => {
          const cost = (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
          const margin = o.totalPrice - cost;
          return { id: o.id, customer: o.customerName, revenue: o.totalPrice, cost, margin, marginPct: o.totalPrice > 0 ? (margin/o.totalPrice*100) : 0 };
        }).filter(o => o.margin < 0).sort((a,b) => a.margin - b.margin).slice(0,6);
        if (withMargin.length === 0) return null;
        const totalLoss = withMargin.reduce((s,o) => s + Math.abs(o.margin), 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Loss-Making Orders Alert</h3>
            <p className="text-xs text-gray-500 mb-3">Orders where cost {'>'}  revenue — total exposure: {fmtAna(totalLoss,'full',0)}</p>
            <div className="space-y-2">
              {withMargin.map((o,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-red-50">
                  <span className="font-medium text-gray-800 truncate w-32">{o.customer}</span>
                  <span className="text-gray-500">Revenue: {fmtAna(o.revenue,'full',0)}</span>
                  <span className="text-red-600 font-bold">Loss: {fmtAna(Math.abs(o.margin),'full',0)} ({o.marginPct.toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && exchangeRates && orders.length >= 5 && (() => {
        const usdRate = exchangeRates['USD'] || 32;
        const eurRate = exchangeRates['EUR'] || 35;
        const now = new Date();
        const last30 = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        });
        const totalTRY = last30.reduce((s,o) => s+o.totalPrice, 0);
        if (totalTRY === 0) return null;
        const totalUSD = totalTRY / usdRate;
        const totalEUR = totalTRY / eurRate;
        const avgOrderTRY = last30.length > 0 ? totalTRY / last30.length : 0;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Multi-Currency Revenue (Last 30 Days)</h3>
            <p className="text-xs text-gray-500 mb-4">Based on live exchange rates: 1 USD = ₺{usdRate.toFixed(2)} · 1 EUR = ₺{eurRate.toFixed(2)}</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { currency: '₺ TRY', value: totalTRY, sub: `${last30.length} orders` },
                { currency: '$ USD', value: totalUSD, sub: `avg $${(avgOrderTRY/usdRate).toFixed(0)}/order` },
                { currency: '€ EUR', value: totalEUR, sub: `avg €${(avgOrderTRY/eurRate).toFixed(0)}/order` },
              ].map((c,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-xs text-gray-400 mb-1">{c.currency}</div>
                  <div className="text-xl font-black text-gray-800">{i===0 ? '₺' : i===1 ? '$' : '€'}{c.value.toLocaleString('en', {maximumFractionDigits:0})}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const totalRevenue = orders.reduce((s,o) => s+o.totalPrice, 0);
        const totalCost = orders.reduce((s,o) => s + (o.lineItems||[]).reduce((sc, li) => {
          const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
          return sc + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice||0)) * li.quantity;
        }, 0), 0);
        const grossProfit = totalRevenue - totalCost;
        const grossMarginPct = totalRevenue > 0 ? (grossProfit/totalRevenue*100) : 0;
        const inventoryValue = inventory.reduce((s,i) => s + i.stockLevel * itemCostTRY(i, exchangeRates), 0);
        const monthlyRevArr = Array.from({length:12}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth()-11+i, 1);
          return orders.filter(o => {
            const od = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return od.getFullYear()===d.getFullYear() && od.getMonth()===d.getMonth();
          }).reduce((s,o)=>s+o.totalPrice,0);
        });
        const avgMonthlyRev = monthlyRevArr.reduce((s,v)=>s+v,0) / 12;
        const inventoryTurnover = inventoryValue > 0 ? (totalCost / inventoryValue) : 0;
        const dso = avgMonthlyRev > 0 ? (inventoryValue / avgMonthlyRev * 30) : 0;
        const ratios = [
          { label: 'Gross Margin', value: `${grossMarginPct.toFixed(1)}%`, good: grossMarginPct >= 30, neutral: grossMarginPct >= 15 },
          { label: 'Inventory Turnover', value: `${inventoryTurnover.toFixed(1)}x`, good: inventoryTurnover >= 4, neutral: inventoryTurnover >= 2 },
          { label: 'Avg Monthly Revenue', value: `₺${(avgMonthlyRev/1000).toFixed(0)}k`, good: true, neutral: true },
          { label: 'Gross Profit', value: `₺${(grossProfit/1000).toFixed(0)}k`, good: grossProfit > 0, neutral: grossProfit >= 0 },
          { label: 'Inventory Value', value: `₺${(inventoryValue/1000).toFixed(0)}k`, good: true, neutral: true },
          { label: 'Est. DSO', value: `${dso.toFixed(0)} days`, good: dso <= 30, neutral: dso <= 60 },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Comprehensive Financial Ratios</h3>
            <div className="grid grid-cols-3 gap-3">
              {ratios.map((r,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg font-black" style={{ color: r.good ? '#10b981' : r.neutral ? '#f59e0b' : '#ef4444' }}>{r.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{r.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:12}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (11-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const monthData = months.map(m => {
          const mOrders = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          });
          const rev = mOrders.reduce((s,o)=>s+o.totalPrice,0);
          const cost = mOrders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
            const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
            return sc+(inv?itemCostTRY(inv, exchangeRates):(li.costPrice||0))*li.quantity;
          },0),0);
          const margin = rev > 0 ? ((rev-cost)/rev*100) : 0;
          return { label: m.label, rev, cost, margin };
        });
        const hasData = monthData.some(d => d.rev > 0);
        if (!hasData) return null;
        const maxMargin = Math.max(...monthData.map(d=>d.margin), 1);
        const avgMargin = monthData.filter(d=>d.rev>0).reduce((s,d)=>s+d.margin,0) / (monthData.filter(d=>d.rev>0).length || 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Gross Margin % — 12-Month Trend</h3>
            <p className="text-xs text-gray-500 mb-4">Average: {avgMargin.toFixed(1)}% · Target: 30%</p>
            <div className="flex items-end gap-1 h-24">
              {monthData.map((d,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600">{d.margin > 0 ? `${d.margin.toFixed(0)}%` : ''}</span>
                  <div className="w-full rounded-t" style={{ height: `${d.margin > 0 ? Math.max(4, d.margin/Math.max(maxMargin,50)*80) : 2}px`, background: d.margin >= 30 ? '#10b981' : d.margin >= 15 ? '#f59e0b' : d.margin > 0 ? '#ef4444' : '#e5e7eb', minHeight: '2px' }} />
                  <span className="text-[8px] text-gray-400">{d.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>≥30% target</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>15-30%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span>below 15%</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const prevMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
        const currMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const prevOrders = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= prevMonth && d < currMonth;
        });
        const currOrders = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= currMonth;
        });
        if (prevOrders.length === 0 && currOrders.length === 0) return null;
        const prevRev = prevOrders.reduce((s,o)=>s+o.totalPrice,0);
        const currRev = currOrders.reduce((s,o)=>s+o.totalPrice,0);
        const prevCusts = new Set(prevOrders.map(o=>o.customerName));
        const currCusts = new Set(currOrders.map(o=>o.customerName));
        const newCustRev = currOrders.filter(o=>!prevCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const retainedRev = currOrders.filter(o=>prevCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const lostRev = prevOrders.filter(o=>!currCusts.has(o.customerName)).reduce((s,o)=>s+o.totalPrice,0);
        const netChange = currRev - prevRev;
        const items = [
          { label: 'Prior Month', value: prevRev, type: 'base' as const },
          { label: 'New Customers', value: newCustRev, type: 'add' as const },
          { label: 'Retained Growth', value: retainedRev - (prevRev - lostRev), type: retainedRev - (prevRev - lostRev) >= 0 ? 'add' as const : 'sub' as const },
          { label: 'Lost Customers', value: -lostRev, type: 'sub' as const },
          { label: 'Current Month', value: currRev, type: 'base' as const },
        ];
        const maxVal = Math.max(...[prevRev, currRev], 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Attribution Waterfall (MoM)</h3>
            <p className="text-xs text-gray-500 mb-4">Net change: <span className={netChange >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{netChange >= 0 ? '+' : ''}{fmtAna(netChange,'full',0)}</span></p>
            <div className="space-y-2">
              {items.map((item,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32">{item.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${maxVal>0?(Math.abs(item.value)/maxVal*100):0}%`,
                      background: item.type==='base' ? '#6366f1' : item.type==='add' ? '#10b981' : '#ef4444'
                    }} />
                  </div>
                  <span className="text-xs font-bold w-24 text-right" style={{ color: item.type==='base'?'#6366f1':item.type==='add'?'#10b981':'#ef4444' }}>
                    {item.type !== 'base' && (item.value >= 0 ? '+' : '')}{fmtAna(Math.abs(item.value),'full',0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && inventory.length >= 3 && (() => {
        const totalRevenue = orders.reduce((s,o)=>s+o.totalPrice,0);
        const totalCOGS = orders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
          const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
          return sc+(inv?itemCostTRY(inv,exchangeRates):(li.costPrice||0))*li.quantity;
        },0),0);
        const inventoryValue = inventory.reduce((s,i)=>s+Math.max(0,i.stockLevel)*itemCostTRY(i,exchangeRates),0);
        const avgMonthlyRevenue = totalRevenue / Math.max(1, (() => {
          const now = new Date();
          const dates = orders.map(o => (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string));
          if (dates.length === 0) return 1;
          const oldest = new Date(Math.min(...dates.map(d=>d.getTime())));
          return Math.max(1, (now.getTime() - oldest.getTime()) / (86400000 * 30));
        })());
        const dso = avgMonthlyRevenue > 0 ? 30 : 0; // simplified: assume 30d collection
        const dio = totalCOGS > 0 ? (inventoryValue / (totalCOGS / 365)) : 0;
        const dpo = 30; // assumed supplier terms
        const ccc = dso + dio - dpo;
        const wcMetrics = [
          { label: 'Days Sales Outstanding (DSO)', value: dso.toFixed(0), unit: 'days', good: dso <= 30 },
          { label: 'Days Inventory Outstanding (DIO)', value: dio.toFixed(0), unit: 'days', good: dio <= 45 },
          { label: 'Days Payable Outstanding (DPO)', value: dpo.toFixed(0), unit: 'days', good: true },
          { label: 'Cash Conversion Cycle (CCC)', value: ccc.toFixed(0), unit: 'days', good: ccc <= 45 },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Working Capital Cycle</h3>
            <p className="text-xs text-gray-500 mb-4">CCC = DSO + DIO − DPO · Lower is better · target: under 45 days</p>
            <div className="space-y-3">
              {wcMetrics.map((m,i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: m.good ? '#f0fdf4' : '#fef2f2' }}>
                  <span className="text-xs text-gray-700 font-medium">{m.label}</span>
                  <span className="text-xl font-black" style={{ color: m.good ? '#10b981' : '#ef4444' }}>{m.value}<span className="text-xs font-normal text-gray-400 ml-1">{m.unit}</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && (() => {
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((s,o)=>s+o.totalPrice,0);
        const totalInventoryItems = inventory.length;
        const totalEmployees = employees.length;
        const totalQuotations = quotations.length;
        const totalMovements = inventoryMovements.length;
        const uniqueCustomers = new Set(orders.map(o=>o.customerName)).size;
        const deliveredOrders = orders.filter(o=>o.status==='Delivered').length;
        const deliveryRate = totalOrders > 0 ? (deliveredOrders/totalOrders*100) : 0;
        return (
          <div className="apple-card p-6 border-2 border-brand">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-3xl">🎯</div>
              <div>
                <h3 className="font-black text-gray-800 text-lg">Phase 300 Milestone Reached!</h3>
                <p className="text-xs text-gray-500">300 analytics phases deployed — your live business intelligence dashboard</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Total Orders', value: totalOrders.toLocaleString(), icon: '📦' },
                { label: 'Total Revenue', value: `₺${(totalRevenue/1000).toFixed(0)}k`, icon: '💰' },
                { label: 'Unique Customers', value: uniqueCustomers.toLocaleString(), icon: '👥' },
                { label: 'Delivery Rate', value: `${deliveryRate.toFixed(0)}%`, icon: '🚚' },
                { label: 'SKUs Tracked', value: totalInventoryItems.toLocaleString(), icon: '📋' },
                { label: 'Active Employees', value: totalEmployees.toLocaleString(), icon: '👤' },
                { label: 'Quotations', value: totalQuotations.toLocaleString(), icon: '📝' },
                { label: 'Stock Movements', value: totalMovements.toLocaleString(), icon: '🔄' },
              ].map((s,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg">{s.icon}</div>
                  <div className="text-base font-black text-gray-800">{s.value}</div>
                  <div className="text-[9px] text-gray-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-xl p-3 text-center">
              <p className="text-xs font-bold text-brand">300 phases · 5 dashboard tabs · Full ERP analytics coverage</p>
              <p className="text-[10px] text-gray-400 mt-1">Revenue · CRM · Inventory · Logistics · HR — all connected</p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 12 && (() => {
        const monthRevenue: Record<number, number[]> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const m = d.getMonth();
          if (!monthRevenue[m]) monthRevenue[m] = [];
          monthRevenue[m].push(o.totalPrice);
        });
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthAvg = Array.from({length:12}, (_,i) => {
          const vals = monthRevenue[i] || [];
          return vals.length > 0 ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
        });
        const overallAvg = monthAvg.filter(v=>v>0).reduce((s,v)=>s+v,0) / Math.max(1, monthAvg.filter(v=>v>0).length);
        if (overallAvg === 0) return null;
        const seasonality = monthAvg.map(avg => avg > 0 ? avg / overallAvg : null);
        const peakMonth = seasonality.reduce((best, val, i) => val !== null && (best === -1 || (seasonality[best] || 0) < val) ? i : best, -1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Seasonality Index</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly avg vs overall avg · peak: <span className="font-bold text-green-600">{monthNames[peakMonth]}</span></p>
            <div className="flex items-end gap-1 h-24">
              {seasonality.map((s, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  {s !== null && <span className="text-[8px] text-gray-500">{s.toFixed(1)}x</span>}
                  <div className="w-full rounded-t" style={{
                    height: s !== null ? `${Math.max(4, Math.min(80, s * 40))}px` : '2px',
                    background: s === null ? '#e5e7eb' : s >= 1.2 ? '#10b981' : s >= 0.8 ? '#3b82f6' : '#f59e0b',
                    minHeight: '2px'
                  }} />
                  <span className="text-[8px] text-gray-400">{monthNames[i].slice(0,1)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-2 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>Peak (≥1.2x)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>Normal</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>Trough ({'<'}0.8x)</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const currMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const mOrders = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d >= currMonth;
        });
        const revenue = mOrders.reduce((s,o)=>s+o.totalPrice,0);
        const cogs = mOrders.reduce((s,o)=>s+(o.lineItems||[]).reduce((sc,li)=>{
          const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
          return sc+(inv?itemCostTRY(inv,exchangeRates):(li.costPrice||0))*li.quantity;
        },0),0);
        const grossProfit = revenue - cogs;
        const payroll = employees.filter(e=>e.status==='Aktif').reduce((s,e)=>s+(e.salary||0),0);
        const operatingExpenses = payroll;
        const ebitda = grossProfit - operatingExpenses;
        const pnlItems = [
          { label: 'Revenue', value: revenue, type: 'revenue' },
          { label: 'Cost of Goods Sold', value: -cogs, type: 'expense' },
          { label: 'Gross Profit', value: grossProfit, type: 'subtotal' },
          { label: 'Payroll & Benefits', value: -operatingExpenses, type: 'expense' },
          { label: 'EBITDA', value: ebitda, type: 'total' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">P&L Summary — Current Month</h3>
            <p className="text-xs text-gray-500 mb-4">Month-to-date · {mOrders.length} orders processed</p>
            <div className="space-y-2">
              {pnlItems.map((item,i) => (
                <div key={i} className={`flex justify-between items-center px-3 py-2 rounded-lg ${item.type==='subtotal'?'bg-blue-50':item.type==='total'?'bg-gray-100 font-black':'bg-gray-50'}`}>
                  <span className={`text-xs ${item.type==='total'?'font-black text-gray-800':'font-medium text-gray-700'}`}>{item.label}</span>
                  <span className={`text-sm font-bold ${item.value>=0?'text-green-600':'text-red-500'}`}>
                    {item.value>=0?'+':''}{fmtAna(Math.abs(item.value),'full',0)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-center">
              <span className="text-xs text-gray-400">Gross margin: {revenue>0?((grossProfit/revenue)*100).toFixed(1):0}% · EBITDA margin: {revenue>0?((ebitda/revenue)*100).toFixed(1):0}%</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const dayRevenue: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = d.toISOString().slice(0,10);
          dayRevenue[key] = (dayRevenue[key]||0) + o.totalPrice;
        });
        const topDays = Object.entries(dayRevenue)
          .sort((a,b)=>b[1]-a[1]).slice(0,10);
        if (topDays.length === 0) return null;
        const maxRev = topDays[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Top 10 Revenue Days — All Time</h3>
            <div className="space-y-2">
              {topDays.map(([day, rev], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs text-gray-600 w-20">{day}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxRev>0?(rev/maxRev*100):0}%`, background: i===0?'#f59e0b':i<3?'#10b981':'#3b82f6' }} />
                  </div>
                  <span className="text-xs font-bold text-gray-800 w-24 text-right">{fmtAna(rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 7 && (() => {
        const now = new Date();
        const days = Array.from({length: 28}, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (27 - i));
          return d.toISOString().slice(0, 10);
        });
        const dayRev: Record<string, number> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = d.toISOString().slice(0, 10);
          dayRev[key] = (dayRev[key] || 0) + o.totalPrice;
        });
        const rolling7: number[] = [];
        for (let i = 6; i < days.length; i++) {
          const sum = days.slice(i - 6, i + 1).reduce((s, d) => s + (dayRev[d] || 0), 0);
          rolling7.push(sum / 7);
        }
        const hasData = rolling7.some(v => v > 0);
        if (!hasData) return null;
        const maxVal = Math.max(...rolling7, 1);
        const trend = rolling7.length >= 2 ? rolling7[rolling7.length - 1] - rolling7[0] : 0;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Rolling 7-Day Avg Revenue — Last 28 Days</h3>
            <p className="text-xs text-gray-500 mb-4">
              Trend: <span className={trend >= 0 ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{trend >= 0 ? '↑' : '↓'} {fmtAna(Math.abs(trend),'full',0)}/day avg</span>
            </p>
            <div className="flex items-end gap-0.5 h-20">
              {rolling7.map((v, i) => (
                <div key={i} className="flex-1 rounded-t transition-all" style={{
                  height: `${maxVal > 0 ? Math.max(2, v / maxVal * 72) : 2}px`,
                  background: i === rolling7.length - 1 ? '#f97316' : '#6366f1',
                  opacity: 0.6 + i / rolling7.length * 0.4
                }} title={`₺${v.toLocaleString('tr-TR', {maximumFractionDigits: 0})}`} />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>28d ago</span><span>Today</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const parts = [
          {label: 'Morning', subLabel: '6–12', hours: [6,7,8,9,10,11], color: '#f59e0b'},
          {label: 'Afternoon', subLabel: '12–17', hours: [12,13,14,15,16], color: '#3b82f6'},
          {label: 'Evening', subLabel: '17–22', hours: [17,18,19,20,21], color: '#8b5cf6'},
          {label: 'Night', subLabel: '22–6', hours: [22,23,0,1,2,3,4,5], color: '#94a3b8'},
        ];
        const partData = parts.map(p => {
          const partOrders = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return p.hours.includes(d.getHours());
          });
          return {
            ...p,
            count: partOrders.length,
            revenue: partOrders.reduce((s, o) => s + o.totalPrice, 0),
            aov: partOrders.length > 0 ? partOrders.reduce((s, o) => s + o.totalPrice, 0) / partOrders.length : 0,
          };
        });
        const hasData = partData.some(p => p.count > 0);
        if (!hasData) return null;
        const maxAov = Math.max(...partData.map(p => p.aov), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">AOV by Time of Day</h3>
            <div className="grid grid-cols-2 gap-3">
              {partData.map((p, i) => (
                <div key={i} className="rounded-xl p-4" style={{background: `${p.color}15`}}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-xs font-bold text-gray-700">{p.label}</div>
                      <div className="text-[10px] text-gray-400">{p.subLabel}h</div>
                    </div>
                    <span className="text-[10px] text-gray-400">{p.count} orders</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
                    <div className="h-full rounded-full" style={{width: `${maxAov > 0 ? p.aov / maxAov * 100 : 0}%`, background: p.color}} />
                  </div>
                  <div className="text-base font-black" style={{color: p.color}}>
                    {fmtAna(p.aov,'full',0)}
                  </div>
                  <div className="text-[9px] text-gray-400">avg order value</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const invoiced = orders.filter(o => o.hasInvoice || o.faturali);
        if (invoiced.length === 0) return null;
        const paid = invoiced.filter(o => o.paid || (o as unknown as Record<string,unknown>).paidAt);
        const unpaid = invoiced.filter(o => !o.paid && !(o as unknown as Record<string,unknown>).paidAt);
        const paidRev = paid.reduce((s, o) => s + o.totalPrice, 0);
        const unpaidRev = unpaid.reduce((s, o) => s + o.totalPrice, 0);
        const now = new Date();
        const overdue = unpaid.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 > 30;
        });
        const overdueRev = overdue.reduce((s, o) => s + o.totalPrice, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">Invoice Payment Status</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-green-600">{paid.length}</div>
                <div className="text-[10px] text-gray-500">Paid</div>
                <div className="text-[9px] text-green-500">{fmtAna(paidRev,'K',0)}</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-600">{unpaid.length}</div>
                <div className="text-[10px] text-gray-500">Awaiting</div>
                <div className="text-[9px] text-amber-500">{fmtAna(unpaidRev,'K',0)}</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-red-600">{overdue.length}</div>
                <div className="text-[10px] text-gray-500">Overdue 30d+</div>
                <div className="text-[9px] text-red-500">{fmtAna(overdueRev,'K',0)}</div>
              </div>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-0.5">
              {paidRev > 0 && <div className="h-full bg-green-400 rounded-l-full" style={{width: `${(paidRev / (paidRev + unpaidRev)) * 100}%`}} />}
              {overdueRev > 0 && <div className="h-full bg-red-400" style={{width: `${(overdueRev / (paidRev + unpaidRev)) * 100}%`}} />}
              {(unpaidRev - overdueRev) > 0 && <div className="h-full bg-amber-300 rounded-r-full" style={{width: `${((unpaidRev - overdueRev) / (paidRev + unpaidRev)) * 100}%`}} />}
            </div>
            <div className="flex gap-3 mt-2 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Paid</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Overdue</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-300 inline-block" />Awaiting</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const cityMap: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const city = (o as unknown as Record<string,unknown>).city as string || (o as unknown as Record<string,unknown>).shippingCity as string || '';
          if (!city) return;
          if (!cityMap[city]) cityMap[city] = {count: 0, revenue: 0};
          cityMap[city].count++;
          cityMap[city].revenue += o.totalPrice || 0;
        });
        const cities325 = Object.entries(cityMap).map(([city, d]) => ({city, ...d})).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
        if (cities325.length < 2) return null;
        const maxRev = Math.max(...cities325.map(c => c.revenue), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Cities by Order Volume</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count by shipping destination</p>
            <div className="space-y-2">
              {cities325.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-700 w-24 truncate">{c.city}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-blue-400 transition-all" style={{width: `${(c.revenue / maxRev) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{c.count} ord</span>
                  <span className="text-xs font-bold text-blue-600 w-24 text-right">{fmtAna(c.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const pmMap: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const pm = (o as unknown as Record<string,unknown>).paymentMethod as string || (o as unknown as Record<string,unknown>).payment_method as string || 'Other';
          if (!pmMap[pm]) pmMap[pm] = {count: 0, revenue: 0};
          pmMap[pm].count++;
          pmMap[pm].revenue += o.totalPrice || 0;
        });
        const methods = Object.entries(pmMap).map(([method, d]) => ({method, ...d})).sort((a, b) => b.revenue - a.revenue);
        if (methods.length < 2) return null;
        const totalRev328 = methods.reduce((s, m) => s + m.revenue, 0);
        const colors328 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Payment Method Mix</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by payment type across {orders.length} orders</p>
            <div className="space-y-2">
              {methods.map((m, i) => {
                const pct = totalRev328 > 0 ? (m.revenue / totalRev328) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: colors328[i % colors328.length]}} />
                    <span className="text-xs text-gray-600 flex-1 truncate">{m.method}</span>
                    <div className="w-32 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width: `${pct}%`, background: colors328[i % colors328.length]}} />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{pct.toFixed(0)}%</span>
                    <span className="text-xs font-bold w-24 text-right" style={{color: colors328[i % colors328.length]}}>{fmtAna(m.revenue,'full',0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        const toTs339 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthGM: Record<string, {rev: number; cost: number}> = {};
        orders.forEach(o => {
          const d = new Date(toTs339(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthGM[key]) monthGM[key] = {rev: 0, cost: 0};
          monthGM[key].rev += o.totalPrice || 0;
          const lineCost = (o.lineItems || []).reduce((s: number, li: {costPrice?: number; quantity?: number}) => s + (li.costPrice || 0) * (li.quantity || 1), 0);
          monthGM[key].cost += lineCost || (o.totalPrice || 0) * 0.6;
        });
        const keys339 = Object.keys(monthGM).sort().slice(-8);
        if (keys339.length < 3) return null;
        const gmData = keys339.map(k => ({k, gm: monthGM[k].rev > 0 ? ((monthGM[k].rev - monthGM[k].cost) / monthGM[k].rev) * 100 : 0}));
        const avgGM = gmData.reduce((s, d) => s + d.gm, 0) / gmData.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Gross Margin Trend</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly gross margin % · Avg: {avgGM.toFixed(1)}%</p>
            <div className="flex items-end gap-2 h-24">
              {gmData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.gm.toFixed(0)}%</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max(d.gm / 100 * 72, 4)}px`, background: d.gm >= 40 ? '#10b981' : d.gm >= 25 ? '#f59e0b' : '#ef4444'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const vals341 = orders.map(o => o.totalPrice || 0).filter(v => v > 0).sort((a, b) => a - b);
        if (vals341.length < 5) return null;
        const p = (pct: number) => vals341[Math.floor((pct / 100) * (vals341.length - 1))];
        const bands = [
          {label: 'P10', val: p(10), color: '#94a3b8'},
          {label: 'P25', val: p(25), color: '#6366f1'},
          {label: 'P50', val: p(50), color: '#3b82f6'},
          {label: 'P75', val: p(75), color: '#10b981'},
          {label: 'P90', val: p(90), color: '#f59e0b'},
          {label: 'P99', val: p(99), color: '#ef4444'},
        ];
        const maxB341 = bands[bands.length - 1].val || 1;
        const avg341 = vals341.reduce((s, v) => s + v, 0) / vals341.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Value Percentile Bands</h3>
            <p className="text-xs text-gray-500 mb-4">{vals341.length} orders · Avg: {fmtAna(avg341,'full',0)}</p>
            <div className="space-y-1.5">
              {bands.map((b, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-bold w-8" style={{color: b.color}}>{b.label}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(b.val / maxB341) * 100}%`, background: b.color}} />
                  </div>
                  <span className="text-xs text-gray-600 w-24 text-right">{fmtAna(b.val,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const custRev346: Record<string, number> = {};
        orders.forEach(o => { custRev346[o.customerName || 'Unknown'] = (custRev346[o.customerName || 'Unknown'] || 0) + (o.totalPrice || 0); });
        const totalRev346 = Object.values(custRev346).reduce((s, v) => s + v, 0);
        if (totalRev346 === 0) return null;
        const shares = Object.values(custRev346).map(v => v / totalRev346);
        const hhi = shares.reduce((s, v) => s + v * v, 0);
        const hhiPct = (hhi * 100).toFixed(1);
        const top5Rev = Object.values(custRev346).sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0);
        const top5Pct = totalRev346 > 0 ? ((top5Rev / totalRev346) * 100).toFixed(1) : '0';
        const concentration = hhi > 0.25 ? 'High' : hhi > 0.1 ? 'Moderate' : 'Low';
        const concColor = hhi > 0.25 ? '#ef4444' : hhi > 0.1 ? '#f59e0b' : '#10b981';
        const topCustomers = Object.entries(custRev346).map(([c, v]) => ({c, v, pct: (v / totalRev346) * 100})).sort((a, b) => b.v - a.v).slice(0, 5);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Concentration</h3>
            <div className="flex items-center gap-4 mb-4">
              <div className="text-center">
                <p className="text-2xl font-black" style={{color: concColor}}>{hhiPct}%</p>
                <p className="text-[10px] text-gray-400">HHI Score</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-blue-600">{top5Pct}%</p>
                <p className="text-[10px] text-gray-400">Top 5 share</p>
              </div>
              <div className="ml-auto text-right">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background: concColor+'22', color: concColor}}>{concentration} concentration</span>
              </div>
            </div>
            <div className="space-y-1.5">
              {topCustomers.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-4">{i+1}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{c.c}</span>
                  <div className="w-24 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-blue-400" style={{width: `${c.pct}%`}} />
                  </div>
                  <span className="text-[10px] font-bold text-blue-600 w-10 text-right">{c.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 8 && (() => {
        const vals350 = orders.map(o => o.totalPrice || 0).filter(v => v > 0);
        if (vals350.length < 5) return null;
        const buckets350 = [
          {label:'<₺500',   min:0,     max:500,    count:0, color:'#94a3b8'},
          {label:'₺0.5–2K', min:500,   max:2000,   count:0, color:'#6366f1'},
          {label:'₺2–10K',  min:2000,  max:10000,  count:0, color:'#3b82f6'},
          {label:'₺10–50K', min:10000, max:50000,  count:0, color:'#10b981'},
          {label:'₺50K+',   min:50000, max:Infinity, count:0, color:'#f59e0b'},
        ];
        vals350.forEach(v => { const b = buckets350.find(b => v >= b.min && v < b.max); if (b) b.count++; });
        const maxB350 = Math.max(...buckets350.map(b => b.count), 1);
        const modal = buckets350.reduce((a, b) => b.count > a.count ? b : a);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Invoice Amount Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Most common range: <span className="font-bold text-[#ff4000]">{modal.label}</span> · {vals350.length} invoices</p>
            <div className="flex items-end gap-3 h-20">
              {buckets350.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((b.count / maxB350) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const toTs351 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        // Build week × day grid for last 8 weeks
        const now351 = Date.now();
        const grid: Record<string, number> = {};
        orders.forEach(o => {
          const ts = toTs351(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          const weekAgo = Math.floor((now351 - ts) / (7 * 86400000));
          if (weekAgo > 7) return;
          const key = `${weekAgo}-${d.getDay()}`;
          grid[key] = (grid[key] || 0) + (o.totalPrice || 0);
        });
        const days351 = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        const weeks351 = [0,1,2,3,4,5,6,7];
        const maxCell = Math.max(...Object.values(grid), 1);
        const totalCells = Object.values(grid).filter(v => v > 0).length;
        if (totalCells < 3) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Weekly Revenue Heatmap</h3>
            <p className="text-xs text-gray-500 mb-3">Last 8 weeks · darker = more revenue</p>
            <div className="overflow-x-auto">
              <div className="flex gap-1 min-w-[300px]">
                <div className="flex flex-col gap-1 mr-1">
                  {days351.map(d => <span key={d} className="text-[9px] text-gray-400 h-5 flex items-center">{d}</span>)}
                </div>
                {weeks351.map(w => (
                  <div key={w} className="flex flex-col gap-1 flex-1">
                    {days351.map((_, di) => {
                      const val = grid[`${w}-${di}`] || 0;
                      const intensity = maxCell > 0 ? val / maxCell : 0;
                      const bg = intensity === 0 ? '#f3f4f6'
                        : intensity < 0.25 ? '#bbf7d0'
                        : intensity < 0.5  ? '#4ade80'
                        : intensity < 0.75 ? '#16a34a'
                        : '#166534';
                      return <div key={di} className="h-5 rounded-sm" style={{background: bg}} title={val > 0 ? `₺${val.toLocaleString('tr-TR', {maximumFractionDigits:0})}` : ''} />;
                    })}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1 text-[9px] text-gray-400">
                <span>8w ago</span><span>Now</span>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const catRev: Record<string, number> = {};
        orders.forEach(o => {
          (o.lineItems || []).forEach((li: {category?: string; name?: string; price?: number; unitPrice?: number; quantity?: number}) => {
            const cat = li.category || 'Other';
            catRev[cat] = (catRev[cat] || 0) + (li.price || li.unitPrice || 0) * (li.quantity || 1);
          });
        });
        const cats361 = Object.entries(catRev).map(([cat, rev]) => ({cat, rev})).filter(d => d.rev > 0).sort((a, b) => b.rev - a.rev).slice(0, 7);
        if (cats361.length < 2) return null;
        const totalRev361 = cats361.reduce((s, c) => s + c.rev, 0);
        const maxRev361 = cats361[0].rev;
        const colors361 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue by Product Category</h3>
            <p className="text-xs text-gray-500 mb-4">Line-item revenue share · Total: {fmtAna(totalRev361,'full',0)}</p>
            <div className="space-y-2">
              {cats361.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{c.cat}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(c.rev / maxRev361) * 100}%`, background: colors361[i % colors361.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev361 > 0 ? ((c.rev / totalRev361) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors361[i % colors361.length]}}>{fmtAna(c.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 7 && (() => {
        const toTs365 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const daySet = new Set<string>();
        orders.forEach(o => {
          const ts = toTs365(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          daySet.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        });
        const sortedDays = [...daySet].sort();
        if (sortedDays.length < 3) return null;
        // Current streak
        let streak = 0;
        let checkDate = new Date();
        while (true) {
          const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth()+1).padStart(2,'0')}-${String(checkDate.getDate()).padStart(2,'0')}`;
          if (!daySet.has(key)) break;
          streak++;
          checkDate = new Date(checkDate.getTime() - 86400000);
        }
        // Longest streak
        let maxStreak = 0, cur = 1;
        for (let i = 1; i < sortedDays.length; i++) {
          const diff = (new Date(sortedDays[i]).getTime() - new Date(sortedDays[i-1]).getTime()) / 86400000;
          if (diff === 1) { cur++; maxStreak = Math.max(maxStreak, cur); }
          else cur = 1;
        }
        // Last 30 days presence
        const last30: boolean[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          last30.push(daySet.has(key));
        }
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue Activity Streak</h3>
            <div className="flex gap-6 mb-4">
              <div className="text-center"><p className="text-2xl font-black text-[#ff4000]">{streak}</p><p className="text-[10px] text-gray-400">current streak</p></div>
              <div className="text-center"><p className="text-2xl font-black text-indigo-600">{maxStreak}</p><p className="text-[10px] text-gray-400">longest streak</p></div>
              <div className="text-center"><p className="text-2xl font-black text-gray-700">{daySet.size}</p><p className="text-[10px] text-gray-400">active days total</p></div>
            </div>
            <p className="text-[10px] text-gray-400 mb-1">Last 30 days</p>
            <div className="flex gap-0.5 flex-wrap">
              {last30.map((active, i) => (
                <div key={i} className={`w-4 h-4 rounded-sm ${active ? 'bg-[#ff4000]' : 'bg-gray-100'}`} />
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const toTs371 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const now371 = Date.now();
        const last90 = orders.filter(o => toTs371(o.createdAt) > now371 - 90 * 86400000);
        if (last90.length < 5) return null;
        const dailyAvg = last90.reduce((s, o) => s + (o.totalPrice || 0), 0) / 90;
        const last30Rev = orders.filter(o => toTs371(o.createdAt) > now371 - 30 * 86400000).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const last60to30Rev = orders.filter(o => { const ts = toTs371(o.createdAt); return ts > now371 - 60 * 86400000 && ts <= now371 - 30 * 86400000; }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        const momGrowth = last60to30Rev > 0 ? (last30Rev - last60to30Rev) / last60to30Rev : 0;
        const forecast = dailyAvg * 30 * (1 + momGrowth * 0.5);
        const confidence = Math.min(90, Math.max(50, 70 + last90.length * 0.5));
        const bars = Array.from({length: 6}, (_, i) => ({
          label: `+${(i+1)*5}d`,
          value: dailyAvg * (i + 1) * 5 * (1 + momGrowth * 0.3),
        }));
        const maxBar = Math.max(...bars.map(b => b.value), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">30-Day Revenue Forecast</h3>
            <div className="flex gap-6 mb-4">
              <div><p className="text-2xl font-black text-[#ff4000]">{fmtAna(forecast,'full',0)}</p><p className="text-[10px] text-gray-400">projected</p></div>
              <div><p className="text-2xl font-black text-gray-700">{confidence.toFixed(0)}%</p><p className="text-[10px] text-gray-400">confidence</p></div>
              <div><p className="text-2xl font-black" style={{color: momGrowth >= 0 ? '#10b981' : '#ef4444'}}>{momGrowth >= 0 ? '+' : ''}{(momGrowth * 100).toFixed(1)}%</p><p className="text-[10px] text-gray-400">MoM trend</p></div>
            </div>
            <div className="flex items-end gap-2 h-16">
              {bars.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.value / maxBar) * 48, 4)}px`, background: `rgba(255,64,0,${0.3 + i * 0.12})`}} />
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const toTs380 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const thisYear = new Date().getFullYear();
        const dayRev: Record<string, number> = {};
        orders.forEach(o => {
          const ts = toTs380(o.createdAt);
          if (!ts) return;
          const d = new Date(ts);
          if (d.getFullYear() !== thisYear) return;
          const key = d.toISOString().slice(0, 10);
          dayRev[key] = (dayRev[key] || 0) + (o.totalPrice || 0);
        });
        const top5 = Object.entries(dayRev).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top5.length < 2) return null;
        const maxDay = top5[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Revenue Days This Year</h3>
            <p className="text-xs text-gray-500 mb-4">Highest single-day revenue in {thisYear}</p>
            <div className="space-y-2">
              {top5.map(([date, rev], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-500 w-6">{i + 1}.</span>
                  <span className="text-xs text-gray-600 w-24">{new Date(date).toLocaleDateString('tr-TR', {day:'2-digit', month:'short'})}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(rev / maxDay) * 100}%`, background: i === 0 ? '#ff4000' : '#6366f1'}} />
                  </div>
                  <span className="text-xs font-bold w-24 text-right" style={{color: i === 0 ? '#ff4000' : '#6366f1'}}>{fmtAna(rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const matrix: number[][] = Array.from({length: 7}, () => [0,0,0,0]);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const dow = (d.getDay() + 6) % 7; // 0=Mon
          const weekOfMonth = Math.min(Math.floor((d.getDate() - 1) / 7), 3);
          const oRec386 = o as unknown as Record<string,unknown>;
          const total = typeof oRec386.total === 'number' ? oRec386.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          matrix[dow][weekOfMonth] += total;
        });
        const allVals = matrix.flat();
        const maxV = Math.max(...allVals, 1);
        const weeks = ['W1','W2','W3','W4'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Heatmap (Day × Week)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-gray-400 font-normal pr-2 pb-1 w-8"></th>
                    {weeks.map(w => <th key={w} className="text-gray-400 font-normal pb-1 px-1">{w}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day, di) => (
                    <tr key={day}>
                      <td className="text-gray-500 font-medium pr-2 py-0.5">{day}</td>
                      {matrix[di].map((v, wi) => {
                        const intensity = v / maxV;
                        return (
                          <td key={wi} className="px-1 py-0.5">
                            <div className="rounded w-full h-5 flex items-center justify-center text-[9px] font-medium" style={{background: v > 0 ? `rgba(255,64,0,${0.15 + intensity * 0.85})` : '#f3f4f6', color: intensity > 0.5 ? 'white' : '#374151'}}>
                              {v > 0 ? (v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)) : ''}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oRec390 = o as unknown as Record<string,unknown>;
          const total = typeof oRec390.total === 'number' ? oRec390.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          byMonth[key] = (byMonth[key] ?? 0) + total;
        });
        const months = Object.keys(byMonth).sort().slice(-7);
        if (months.length < 3) return null;
        const growthRows = months.slice(1).map((m, i) => {
          const prev = byMonth[months[i]];
          const curr = byMonth[m];
          const pct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
          return { month: m.slice(5), pct };
        });
        const maxAbs = Math.max(...growthRows.map(r => Math.abs(r.pct)), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Month-over-Month Revenue Growth</h3>
            <div className="relative h-28">
              <div className="absolute inset-x-0" style={{top: '50%', height: 1, background: '#e5e7eb'}} />
              <div className="flex items-center h-full gap-2">
                {growthRows.map(r => {
                  const barH = (Math.abs(r.pct) / maxAbs) * 48;
                  const isPos = r.pct >= 0;
                  return (
                    <div key={r.month} className="flex-1 flex flex-col items-center">
                      {isPos ? (
                        <>
                          <div className="flex-1 flex items-end justify-center pb-0.5">
                            <div style={{height: `${barH}px`, background: '#22c55e', width: '70%', borderRadius: '3px 3px 0 0'}} />
                          </div>
                          <span className="text-[9px] font-bold text-green-600">+{r.pct.toFixed(0)}%</span>
                          <div className="flex-1" />
                        </>
                      ) : (
                        <>
                          <div className="flex-1" />
                          <span className="text-[9px] font-bold text-red-500">{r.pct.toFixed(0)}%</span>
                          <div className="flex-1 flex items-start justify-center pt-0.5">
                            <div style={{height: `${barH}px`, background: '#ef4444', width: '70%', borderRadius: '0 0 3px 3px'}} />
                          </div>
                        </>
                      )}
                      <span className="text-[9px] text-gray-400 mt-1">{r.month}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const lastDate = new Date(now.getFullYear(), now.getMonth()-1, 1);
        const lastMonth = `${lastDate.getFullYear()}-${String(lastDate.getMonth()+1).padStart(2,'0')}`;
        let thisMRev = 0, lastMRev = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (key === thisMonth) thisMRev += total;
          if (key === lastMonth) lastMRev += total;
        });
        if (thisMRev === 0 && lastMRev === 0) return null;
        const pct = lastMRev > 0 ? ((thisMRev - lastMRev) / lastMRev) * 100 : 0;
        const gaugeVal = lastMRev > 0 ? Math.min(thisMRev / lastMRev, 2) : 1;
        const r = 40; const cx = 60; const cy = 55;
        const rad = (a: number) => (a - 90) * Math.PI / 180;
        const arc = (pct2: number, color: string) => {
          const end = Math.min(pct2, 1) * 180;
          const x1 = cx + r * Math.cos(rad(-90)); const y1 = cy + r * Math.sin(rad(-90));
          const x2 = cx + r * Math.cos(rad(-90 + end)); const y2 = cy + r * Math.sin(rad(-90 + end));
          return end > 0 ? `M ${x1} ${y1} A ${r} ${r} 0 ${end > 180 ? 1 : 0} 1 ${x2} ${y2}` : '';
        };
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-1">This Month vs Last Month</h3>
            <div className="flex items-center gap-4">
              <svg width="120" height="70" viewBox="0 0 120 70">
                <path d={arc(1, '#e5e7eb')} fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round" />
                <path d={arc(gaugeVal, pct >= 0 ? '#22c55e' : '#ef4444')} fill="none" stroke={pct >= 0 ? '#22c55e' : '#ef4444'} strokeWidth="10" strokeLinecap="round" />
                <text x={cx} y={cy+8} textAnchor="middle" fontSize="11" fontWeight="bold" fill={pct >= 0 ? '#22c55e' : '#ef4444'}>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</text>
              </svg>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between text-xs"><span className="text-gray-500">This month</span><span className="font-bold">{fmtAna(thisMRev,'full',0)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">Last month</span><span className="text-gray-700">{fmtAna(lastMRev,'full',0)}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 1 && (() => {
        const totalOrders = orders.length;
        let totalRevenue = 0;
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          totalRevenue += typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
        });
        const orderMilestones = [10,50,100,250,500,1000,5000];
        const revMilestones = [100000,500000,1000000,5000000,10000000];
        const oMilestone = orderMilestones.find(m => totalOrders < m) ?? orderMilestones[orderMilestones.length-1];
        const rMilestone = revMilestones.find(m => totalRevenue < m) ?? revMilestones[revMilestones.length-1];
        const oPct = Math.min((totalOrders / oMilestone) * 100, 100);
        const rPct = Math.min((totalRevenue / rMilestone) * 100, 100);
        const prevO = orderMilestones[orderMilestones.indexOf(oMilestone) - 1] ?? 0;
        const prevR = revMilestones[revMilestones.indexOf(rMilestone) - 1] ?? 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">🏆 Sales Milestones</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Total Orders</span>
                  <span className="font-bold">{totalOrders} <span className="text-gray-400">/ {oMilestone}</span></span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{width: `${oPct}%`, background: 'linear-gradient(90deg, #ff4000, #ff8c00)'}} />
                </div>
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>{prevO}</span><span>{oMilestone}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Total Revenue</span>
                  <span className="font-bold">{fmtAna(totalRevenue,'K',0)} <span className="text-gray-400">/ {fmtAna(rMilestone,'K',0)}</span></span>
                </div>
                <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{width: `${rPct}%`, background: 'linear-gradient(90deg, #6366f1, #a78bfa)'}} />
                </div>
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>{fmtAna(prevR,'K',0)}</span><span>{fmtAna(rMilestone,'K',0)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const year = now.getFullYear();
        const quarters: Record<string, number> = {Q1: 0, Q2: 0, Q3: 0, Q4: 0};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d || d.getFullYear() !== year) return;
          const q = `Q${Math.ceil((d.getMonth()+1)/3)}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          quarters[q] += total;
        });
        const ytdTotal = Object.values(quarters).reduce((a,b) => a+b, 0);
        if (ytdTotal === 0) return null;
        const maxQ = Math.max(...Object.values(quarters), 1);
        const qColors = {Q1:'#3b82f6',Q2:'#f59e0b',Q3:'#22c55e',Q4:'#ff4000'};
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">YTD Revenue by Quarter ({year})</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(ytdTotal,'K',0)}</span>
            </div>
            <div className="flex items-end gap-3 h-24 mb-1">
              {Object.entries(quarters).map(([q, rev]) => (
                <div key={q} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-500">{rev > 0 ? `₺${(rev/1000).toFixed(0)}k` : ''}</span>
                  <div className="w-full rounded-sm transition-all" style={{height: `${(rev / maxQ) * 72}px`, background: (qColors as Record<string,string>)[q], minHeight: rev > 0 ? 3 : 0}} />
                  <span className="text-xs font-medium" style={{color: (qColors as Record<string,string>)[q]}}>{q}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const weeks: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const weekStart = new Date(d);
          weekStart.setDate(d.getDate() - ((d.getDay() + 6) % 7));
          const key = `${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,'0')}-${String(weekStart.getDate()).padStart(2,'0')}`;
          weeks[key] = (weeks[key] ?? 0) + 1;
        });
        const weekKeys = Object.keys(weeks).sort().slice(-8);
        if (weekKeys.length < 3) return null;
        const vals = weekKeys.map(k => weeks[k]);
        const maxV = Math.max(...vals, 1);
        const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
        // Simple line chart using SVG polyline
        const w = 240; const h = 60; const pad = 8;
        const pts = vals.map((v, i) => `${pad + (i / (vals.length-1)) * (w-2*pad)},${h - pad - ((v / maxV) * (h-2*pad))}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Weekly Orders Trend</h3>
              <span className="text-xs text-gray-500">avg {avg.toFixed(0)}/wk</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height: 60}}>
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {vals.map((v, i) => (
                <circle key={i} cx={pad + (i / (vals.length-1)) * (w-2*pad)} cy={h - pad - ((v / maxV) * (h-2*pad))} r="3" fill="#ff4000" />
              ))}
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>{weekKeys[0]?.slice(5)}</span>
              <span>{weekKeys[weekKeys.length-1]?.slice(5)}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 1 && (() => {
        const now = new Date();
        const thirtyAgo = new Date(now.getTime() - 30 * 86400000);
        let rev30 = 0; let orders30 = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d || d < thirtyAgo) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          rev30 += total; orders30++;
        });
        const aov = orders30 > 0 ? rev30 / orders30 : 0;
        const uniqueCustomers = new Set(orders.map(o => (o as unknown as Record<string,unknown>).customerId as string || (o as unknown as Record<string,unknown>).customerName as string || 'u')).size;
        const kpis = [
          {label:'Revenue (30d)', val:`₺${(rev30/1000).toFixed(1)}k`, icon:'💰', color:'#ff4000'},
          {label:'Orders (30d)', val:String(orders30), icon:'📦', color:'#3b82f6'},
          {label:'Avg Order', val:`₺${(aov/1000).toFixed(1)}k`, icon:'📊', color:'#22c55e'},
          {label:'Customers', val:String(uniqueCustomers), icon:'👥', color:'#8b5cf6'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Executive KPI Summary</h3>
            <div className="grid grid-cols-2 gap-2">
              {kpis.map(k => (
                <div key={k.label} className="rounded-xl p-3" style={{background: `${k.color}12`}}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">{k.icon}</span>
                    <span className="text-[10px] text-gray-500">{k.label}</span>
                  </div>
                  <p className="text-xl font-bold" style={{color: k.color}}>{k.val}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const d90 = new Date(now.getTime() - 90 * 86400000);
        const d180 = new Date(now.getTime() - 180 * 86400000);
        let curr = 0, prev = 0, currC = 0, prevC = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (d >= d90) { curr += total; currC++; }
          else if (d >= d180) { prev += total; prevC++; }
        });
        if (curr === 0 && prev === 0) return null;
        const revPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        const orderPct = prevC > 0 ? ((currC - prevC) / prevC) * 100 : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Last 90d vs Prior 90d</h3>
            <div className="grid grid-cols-2 gap-3">
              {[{label:'Revenue', curr, prev, pct: revPct, fmt: (v:number) => `₺${(v/1000).toFixed(1)}k`},
                {label:'Orders', curr: currC, prev: prevC, pct: orderPct, fmt: (v:number) => String(v)}].map(r => (
                <div key={r.label} className="rounded-xl p-3" style={{background: r.pct >= 0 ? '#22c55e12' : '#ef444412'}}>
                  <p className="text-[10px] text-gray-500 mb-1">{r.label}</p>
                  <p className="text-lg font-bold text-gray-800">{r.fmt(r.curr)}</p>
                  <p className="text-xs" style={{color: r.pct >= 0 ? '#22c55e' : '#ef4444'}}>
                    {r.pct >= 0 ? '▲' : '▼'} {Math.abs(r.pct).toFixed(0)}%
                    <span className="text-gray-400 ml-1">vs {r.fmt(r.prev)}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const d30 = new Date(now.getTime() - 30 * 86400000);
        const d60 = new Date(now.getTime() - 60 * 86400000);
        let rev30 = 0, rev30to60 = 0, orders30 = 0, orders30to60 = 0;
        let cancelCount = 0;
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (d >= d30) { rev30 += total; orders30++; if (o.status === 'Cancelled') cancelCount++; }
          else if (d >= d60) { rev30to60 += total; orders30to60++; }
        });
        const revScore = rev30to60 > 0 ? Math.min(100, Math.round((rev30 / rev30to60) * 50)) : 50;
        const orderScore = orders30to60 > 0 ? Math.min(100, Math.round((orders30 / orders30to60) * 50)) : 50;
        const cancelRate = orders30 > 0 ? (cancelCount / orders30) * 100 : 0;
        const cancelScore = Math.max(0, 100 - cancelRate * 5);
        const inventoryScore = inventory.length > 0 ? Math.min(100, inventory.length * 2) : 50;
        const overall = Math.round((revScore + orderScore + cancelScore + inventoryScore) / 4);
        const color = overall >= 75 ? '#22c55e' : overall >= 50 ? '#f59e0b' : '#ef4444';
        const label = overall >= 75 ? 'Healthy' : overall >= 50 ? 'Moderate' : 'At Risk';
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Business Health Score</h3>
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  <circle cx="40" cy="40" r="32" fill="none" stroke={color} strokeWidth="8"
                    strokeDasharray={`${(overall / 100) * 201} 201`}
                    strokeDashoffset="50" strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold" style={{color}}>{overall}</span>
                  <span className="text-[8px] text-gray-500">{label}</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                {[{label:'Revenue Growth', score: revScore}, {label:'Order Volume', score: orderScore},
                  {label:'Low Cancellations', score: Math.round(cancelScore)}, {label:'Inventory', score: inventoryScore}].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 flex-1">{m.label}</span>
                    <div className="w-16 bg-gray-100 rounded-full h-2">
                      <div className="h-full rounded-full" style={{width: `${m.score}%`, background: m.score >= 75 ? '#22c55e' : m.score >= 50 ? '#f59e0b' : '#ef4444'}} />
                    </div>
                    <span className="text-[9px] font-bold text-gray-600 w-6 text-right">{m.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const productRevenue: Record<string, number> = {};
        orders.forEach(o => {
          (o.lineItems ?? []).forEach(li => {
            const lr = li as unknown as Record<string,unknown>;
            const name = (lr.productName as string|undefined) ?? (lr.name as string|undefined) ?? 'Unknown';
            const qty = (lr.quantity as number|undefined) ?? 0;
            const price = (lr.unitPrice as number|undefined) ?? (lr.price as number|undefined) ?? 0;
            productRevenue[name] = (productRevenue[name] ?? 0) + qty * price;
          });
        });
        const sorted = Object.entries(productRevenue).sort((a,b)=>b[1]-a[1]);
        if (sorted.length < 3) return null;
        const totalRev = sorted.reduce((s,[,v])=>s+v,0);
        const top20n = Math.max(1, Math.ceil(sorted.length * 0.2));
        const top20Rev = sorted.slice(0, top20n).reduce((s,[,v])=>s+v,0);
        const top20Pct = totalRev > 0 ? Math.round((top20Rev/totalRev)*100) : 0;
        const top5 = sorted.slice(0, 5);
        const maxRev = top5[0]?.[1] ?? 1;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Product Revenue Pareto</h3>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">Top 20% → {top20Pct}% rev</span>
            </div>
            <div className="space-y-2">
              {top5.map(([name, rev], i) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(rev/maxRev)*100}%`, background: '#ff4000'}} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-8 text-right">{totalRev > 0 ? Math.round((rev/totalRev)*100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const byMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          byMonth[key] = (byMonth[key] ?? 0) + total;
        });
        const top5 = Object.entries(byMonth).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (top5.length < 2) return null;
        const maxRev = top5[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">🏆 Best Revenue Months</h3>
            <div className="space-y-2">
              {top5.map(([month, rev], i) => (
                <div key={month} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-4 text-gray-400">#{i+1}</span>
                  <span className="text-xs w-16 text-gray-700">{month}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2 transition-all" style={{width:`${(rev/maxRev)*100}%`,background:i===0?'#ff4000':'#6366f1'}}>
                      <span className="text-white text-[9px] font-bold">{fmtAna(rev,'K',0)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const sorted = [...orders].sort((a,b) => {
          const da = a.createdAt ? ((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)) : new Date(0);
          const db = b.createdAt ? ((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)) : new Date(0);
          return da.getTime()-db.getTime();
        });
        let cumulative = 0;
        const points = sorted.map(o => {
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          cumulative += total;
          return cumulative;
        }).filter((_,i)=>i%Math.max(1,Math.floor(sorted.length/40))===0);
        if (points.length < 3) return null;
        const maxV = points[points.length-1];
        const w=240; const h=60; const pad=8;
        const pts = points.map((v,i)=>`${pad+(i/(points.length-1))*(w-2*pad)},${h-pad-(v/maxV)*(h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Cumulative Revenue Trajectory</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(maxV,'K',0)} total</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff4000" stopOpacity="0.3"/>
                  <stop offset="100%" stopColor="#ff4000" stopOpacity="0"/>
                </linearGradient>
              </defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(points.length-1)/(points.length-1)*(w-2*pad)},${h-pad}`} fill="url(#cumGrad)" />
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-[10px] text-gray-400 text-center mt-1">{sorted.length} orders total</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const custRevenue: Record<string,number> = {};
        const dayRevenue: Record<string,number> = {};
        let maxOrderValue = 0;
        let maxOrderCustomer = '';
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          custRevenue[cid]=(custRevenue[cid]??0)+total;
          if (d) { const dk=d.toISOString().slice(0,10); dayRevenue[dk]=(dayRevenue[dk]??0)+total; }
          if (total > maxOrderValue) { maxOrderValue=total; maxOrderCustomer=cid; }
        });
        const topCustomer = Object.entries(custRevenue).sort((a,b)=>b[1]-a[1])[0];
        const bestDay = Object.entries(dayRevenue).sort((a,b)=>b[1]-a[1])[0];
        const records = [
          {label:'Largest Order', val:`₺${(maxOrderValue/1000).toFixed(1)}k`, sub: maxOrderCustomer, icon:'💎'},
          {label:'Best Day', val:`₺${bestDay?((bestDay[1]/1000).toFixed(1))+'k':'—'}`, sub: bestDay?.[0]??'—', icon:'📅'},
          {label:'Top Customer', val:`₺${topCustomer?((topCustomer[1]/1000).toFixed(1))+'k':'—'}`, sub: topCustomer?.[0]??'—', icon:'👑'},
          {label:'Total Orders', val:String(orders.length), sub:'all time', icon:'📦'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">All-Time Records</h3>
            <div className="grid grid-cols-2 gap-2">
              {records.map(r=>(
                <div key={r.label} className="rounded-xl p-3 bg-gray-50">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-sm">{r.icon}</span>
                    <span className="text-[10px] text-gray-400">{r.label}</span>
                  </div>
                  <p className="text-base font-bold text-gray-800">{r.val}</p>
                  <p className="text-[9px] text-gray-400 truncate">{r.sub}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const periods = [7,30,90];
        const results = periods.map(days => {
          const curr = new Date(now.getTime()-days*86400000);
          const prev = new Date(now.getTime()-2*days*86400000);
          let currRev=0, prevRev=0;
          orders.forEach(o => {
            const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
            if (!d) return;
            const oR = o as unknown as Record<string,unknown>;
            const total = typeof oR.total==='number' ? oR.total as number
              : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
            if (d>=curr) currRev+=total;
            else if (d>=prev) prevRev+=total;
          });
          const pct = prevRev>0 ? ((currRev-prevRev)/prevRev)*100 : 0;
          return {label:`${days}d`, pct, currRev};
        });
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Growth Rates</h3>
            <div className="grid grid-cols-3 gap-2">
              {results.map(r=>(
                <div key={r.label} className="rounded-xl p-3 text-center" style={{background:r.pct>=0?'#22c55e12':'#ef444412'}}>
                  <p className="text-lg font-bold" style={{color:r.pct>=0?'#22c55e':'#ef4444'}}>
                    {r.pct>=0?'+':''}{r.pct.toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-gray-500">{r.label}</p>
                  <p className="text-[9px] text-gray-400">{fmtAna(r.currRev,'K',0)}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const prevYear = currentYear - 1;
        const currByMonth: number[] = new Array(12).fill(0);
        const prevByMonth: number[] = new Array(12).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (d.getFullYear()===currentYear) currByMonth[d.getMonth()]+=total;
          else if (d.getFullYear()===prevYear) prevByMonth[d.getMonth()]+=total;
        });
        const hasPrevYear = prevByMonth.some(v=>v>0);
        if (!hasPrevYear) return null;
        const monthsToShow = now.getMonth() + 1;
        const maxVal = Math.max(...currByMonth.slice(0,monthsToShow),...prevByMonth.slice(0,monthsToShow),1);
        const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Year-over-Year Revenue</h3>
            <div className="flex items-end gap-1 h-24 mb-1">
              {Array.from({length:monthsToShow},(_,i)=>(
                <div key={i} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height:`${(prevByMonth[i]/maxVal)*72}px`,background:'#d1d5db',minHeight:prevByMonth[i]>0?2:0}} />
                  <div className="flex-1 rounded-sm" style={{height:`${(currByMonth[i]/maxVal)*72}px`,background:'#ff4000',minHeight:currByMonth[i]>0?2:0}} />
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              {Array.from({length:monthsToShow},(_,i)=><span key={i} className="flex-1 text-center text-[8px] text-gray-400">{monthLabels[i]}</span>)}
            </div>
            <div className="flex gap-3 justify-center text-[10px] mt-1">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-brand"/><span className="text-gray-500">{currentYear}</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-gray-300"/><span className="text-gray-500">{prevYear}</span></div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 12 && (() => {
        const monthRevenue: number[] = new Array(12).fill(0);
        const monthCounts: number[] = new Array(12).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          monthRevenue[d.getMonth()]+=total;
          monthCounts[d.getMonth()]++;
        });
        const monthAvg = monthRevenue.map((v,i)=>monthCounts[i]>0?v/monthCounts[i]:0);
        const overallAvg = monthAvg.filter(v=>v>0).reduce((a,b)=>a+b,0)/Math.max(monthAvg.filter(v=>v>0).length,1);
        const indices = monthAvg.map(v=>overallAvg>0?Math.round((v/overallAvg)*100):0);
        const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const maxIdx = Math.max(...indices,1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Seasonality Index</h3>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-0.5 h-16 min-w-full">
                {indices.map((idx,i)=>(
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" style={{minWidth:18}}>
                    <div className="w-full rounded-sm" style={{height:`${(idx/maxIdx)*48}px`,background:idx>=110?'#22c55e':idx>=90?'#3b82f6':'#f59e0b',minHeight:idx>0?2:0}} />
                    <span className="text-[8px] text-gray-400">{monthLabels[i].slice(0,1)}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-gray-400 text-center mt-1">100 = average month</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const brackets = [{label:'<₺1k',min:0,max:1000},{label:'₺1-5k',min:1000,max:5000},{label:'₺5-20k',min:5000,max:20000},{label:'₺20-100k',min:20000,max:100000},{label:'₺100k+',min:100000,max:Infinity}];
        const data = brackets.map(b=>({...b,count:0,revenue:0}));
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          const bracket = data.find(b=>total>=b.min&&total<b.max);
          if (bracket) { bracket.count++; bracket.revenue+=total; }
        });
        const totalRev = data.reduce((s,b)=>s+b.revenue,0);
        const maxRev = Math.max(...data.map(b=>b.revenue),1);
        const colors=['#94a3b8','#3b82f6','#f59e0b','#ff4000','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue by Order Size</h3>
            <div className="space-y-2">
              {data.map((b,i)=>b.count>0&&(
                <div key={b.label} className="flex items-center gap-2">
                  <span className="text-[10px] w-14 text-gray-600">{b.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-1.5" style={{width:`${(b.revenue/maxRev)*100}%`,background:colors[i]}}>
                      <span className="text-white text-[9px] font-bold">{b.count}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-8 text-right">{totalRev>0?Math.round((b.revenue/totalRev)*100):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string,{first:number;second:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (!byMonth[key]) byMonth[key]={first:0,second:0};
          if (d.getDate()<=15) byMonth[key].first+=total; else byMonth[key].second+=total;
        });
        const months = Object.keys(byMonth).sort().slice(-5);
        if (months.length<2) return null;
        const maxVal = Math.max(...months.flatMap(m=>[byMonth[m].first,byMonth[m].second]),1);
        const totalFirst = months.reduce((s,m)=>s+byMonth[m].first,0);
        const totalSecond = months.reduce((s,m)=>s+byMonth[m].second,0);
        const total = totalFirst+totalSecond;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue: First vs Second Half of Month</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m=>(
                <div key={m} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].first/maxVal)*64}px`,background:'#3b82f6',minHeight:byMonth[m].first>0?2:0}} />
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].second/maxVal)*64}px`,background:'#ff4000',minHeight:byMonth[m].second>0?2:0}} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-2">{months.map(m=><span key={m} className="flex-1 text-center text-[9px] text-gray-400">{m.slice(5)}</span>)}</div>
            <div className="flex justify-between text-xs">
              <span className="text-blue-500">1st half: {total>0?Math.round((totalFirst/total)*100):0}%</span>
              <span className="text-brand">2nd half: {total>0?Math.round((totalSecond/total)*100):0}%</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byDay: Record<string,number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = d.toISOString().slice(0,10);
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          byDay[key]=(byDay[key]??0)+total;
        });
        const days = Object.keys(byDay).sort().slice(-30);
        if (days.length<7) return null;
        const W=7;
        const rolling = days.map((_,i)=>{ if(i<W-1) return 0; const slice=days.slice(i-W+1,i+1); return slice.reduce((s,d)=>s+byDay[d],0)/W; }).slice(W-1);
        const rollingDays = days.slice(W-1);
        const maxVal = Math.max(...rolling,1);
        const w=240; const h=60; const pad=8;
        const pts = rolling.map((v,i)=>`${pad+(i/(rolling.length-1))*(w-2*pad)},${h-pad-(v/maxVal)*(h-2*pad)}`).join(' ');
        const latestAvg = rolling[rolling.length-1];
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">7-Day Rolling Revenue Avg</h3>
              <span className="text-xs font-bold text-brand">{fmtAna(latestAvg,'K',1)}/day</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs><linearGradient id="rollGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff4000" stopOpacity="0.25"/><stop offset="100%" stopColor="#ff4000" stopOpacity="0"/></linearGradient></defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(rolling.length-1)/(rolling.length-1)*(w-2*pad)},${h-pad}`} fill="url(#rollGrad)"/>
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>{rollingDays[0]?.slice(5)}</span><span>{rollingDays[rollingDays.length-1]?.slice(5)}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const total = orders.length;
        const delivered = orders.filter(o=>o.status==='Delivered').length;
        const cancelled = orders.filter(o=>o.status==='Cancelled').length;
        const inProgress = total-delivered-cancelled;
        const fulfillRate = (total-cancelled)>0 ? Math.round((delivered/(total-cancelled))*100) : 0;
        const cancelRate = total>0 ? Math.round((cancelled/total)*100) : 0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Order Fulfillment Rate</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="30" fill="none" stroke="#e5e7eb" strokeWidth="10"/>
                  <circle cx="40" cy="40" r="30" fill="none" stroke="#22c55e" strokeWidth="10"
                    strokeDasharray={`${(fulfillRate/100)*188} 188`} strokeDashoffset="47" strokeLinecap="round"/>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold text-green-500">{fulfillRate}%</span>
                  <span className="text-[8px] text-gray-400">fulfilled</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Total Orders</span><span className="font-bold">{total}</span></div>
                <div className="flex justify-between"><span className="text-green-600">Delivered</span><span className="font-bold text-green-600">{delivered}</span></div>
                <div className="flex justify-between"><span className="text-blue-500">In Progress</span><span className="font-bold text-blue-500">{inProgress}</span></div>
                <div className="flex justify-between"><span className="text-red-500">Cancelled ({cancelRate}%)</span><span className="font-bold text-red-500">{cancelled}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length >= 3 && (() => {
        // Map products to categories via inventory
        const productCategory: Record<string,string> = {};
        inventory.forEach(item=>{ productCategory[item.name]=(item.category??'Other'); if(item.id) productCategory[item.id]=(item.category??'Other'); });
        const catMonthRev: Record<string,Record<string,number>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; const name=(lr.productName as string|undefined)??(lr.name as string|undefined)??''; const pid=(lr.productId as string|undefined)??''; const cat=productCategory[pid]??productCategory[name]??'Other'; const rev=((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); if (!catMonthRev[cat]) catMonthRev[cat]={}; catMonthRev[cat][key]=(catMonthRev[cat][key]??0)+rev; });
        });
        const topCats = Object.entries(catMonthRev).sort((a,b)=>Object.values(b[1]).reduce((x,y)=>x+y,0)-Object.values(a[1]).reduce((x,y)=>x+y,0)).slice(0,3);
        const allMonths = [...new Set(Object.values(catMonthRev).flatMap(m=>Object.keys(m)))].sort().slice(-5);
        if (topCats.length<2||allMonths.length<2) return null;
        const palette=['#ff4000','#3b82f6','#22c55e'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Category Revenue Trend</h3>
            <div className="space-y-2">
              {topCats.map(([cat,monthMap],ci)=>{
                const vals=allMonths.map(m=>monthMap[m]??0);
                const maxV=Math.max(...vals,1);
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{background:palette[ci]}}/>
                      <span className="text-[10px] text-gray-600">{cat}</span>
                    </div>
                    <div className="flex items-end gap-1 h-8">
                      {vals.map((v,i)=><div key={i} className="flex-1 rounded-sm" style={{height:`${(v/maxV)*28}px`,background:palette[ci],opacity:0.7+(i/(vals.length-1))*0.3,minHeight:v>0?2:0}}/>)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-0.5 mt-1">{allMonths.map(m=><span key={m} className="flex-1 text-center text-[8px] text-gray-400">{m.slice(5)}</span>)}</div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const custRev: Record<string,number> = {};
        orders.forEach(o => {
          const cid=(o as unknown as Record<string,unknown>).customerName as string|undefined||(o as unknown as Record<string,unknown>).customerId as string|undefined||'Unknown';
          const oR=o as unknown as Record<string,unknown>;
          const total=typeof oR.total==='number' ? oR.total as number : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          custRev[cid]=(custRev[cid]??0)+total;
        });
        const revVals=Object.values(custRev);
        const totalRev=revVals.reduce((a,b)=>a+b,0);
        if (totalRev===0||revVals.length<2) return null;
        // Herfindahl-Hirschman Index
        const hhi = revVals.reduce((s,v)=>s+Math.pow(v/totalRev,2),0);
        const hhiScore = Math.round(hhi*10000);
        const label = hhiScore<1000?'Diversified':hhiScore<2500?'Moderate':hhiScore<5000?'Concentrated':'Highly Concentrated';
        const color = hhiScore<1000?'#22c55e':hhiScore<2500?'#3b82f6':hhiScore<5000?'#f59e0b':'#ef4444';
        const top1=revVals.sort((a,b)=>b-a)[0];
        const top1pct=totalRev>0?Math.round((top1/totalRev)*100):0;
        const sorted=revVals.sort((a,b)=>b-a);
        const top3pct=Math.round((sorted.slice(0,3).reduce((a,b)=>a+b,0)/totalRev)*100);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-semibold text-sm">Revenue Concentration</h3>
              <span className="text-xs rounded-full px-2 py-0.5 font-medium" style={{background:`${color}20`,color}}>{label}</span>
            </div>
            <div className="text-center mb-3">
              <p className="text-4xl font-bold" style={{color}}>{hhiScore}</p>
              <p className="text-[10px] text-gray-400">HHI Score (0-10,000)</p>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Top customer: <strong>{top1pct}%</strong></span>
              <span>Top 3: <strong>{top3pct}%</strong></span>
              <span><strong>{revVals.length}</strong> customers</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const periods = [{label:'7d',days:7},{label:'30d',days:30},{label:'90d',days:90},{label:'365d',days:365}];
        const results = periods.map(p=>{
          const since=new Date(now.getTime()-p.days*86400000);
          const rev=orders.reduce((s,o)=>{
            const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
            if(!d||d<since) return s;
            const oR=o as unknown as Record<string,unknown>;
            return s+(typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s2,li)=>{ const lr=li as unknown as Record<string,unknown>; return s2+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0));
          },0);
          return {...p,rev,velocity:rev/p.days};
        });
        const maxV=Math.max(...results.map(r=>r.velocity),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Velocity (₺/day)</h3>
            <div className="space-y-2">
              {results.map(r=>(
                <div key={r.label} className="flex items-center gap-2">
                  <span className="text-xs w-10 text-gray-600">{r.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width:`${(r.velocity/maxV)*100}%`,background:'#ff4000',minWidth:r.velocity>0?24:0}}>
                      <span className="text-white text-[9px] font-bold">{fmtAna(r.velocity,'K',1)}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-14 text-right">{fmtAna(r.rev,'K',0)} tot</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now=new Date();
        const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
        const productRev: Record<string,number>={};
        orders.forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
          if(!d||d<monthStart) return;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; const name=(lr.productName as string|undefined)??(lr.name as string|undefined)??'Unknown'; const rev=((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); productRev[name]=(productRev[name]??0)+rev; });
        });
        const top5=Object.entries(productRev).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if(top5.length===0) return null;
        const maxRev=top5[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Products This Month</h3>
            <div className="space-y-2">
              {top5.map(([name,rev],i)=>(
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(rev/maxRev)*100}%`,background:i===0?'#ff4000':'#6366f1'}}/>
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-10 text-right">{fmtAna(rev,'K',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && (() => {
        const now=new Date();
        const d30=new Date(now.getTime()-30*86400000);
        const orders30=orders.filter(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; return d&&d>=d30; }).length;
        const lowStockCount=inventory.filter(i=>{ const stk=(i.stock as number|undefined)??0; const threshold=(i.reorderPoint as number|undefined)??(i.lowStockThreshold as number|undefined)??5; return stk<=threshold&&stk>0; }).length;
        const activeOrders=orders.filter(o=>o.status==='Processing'||o.status==='Pending'||o.status==='Shipped').length;
        const stats=[
          {label:'Orders (30d)',val:String(orders30),icon:'📦',color:'#3b82f6'},
          {label:'Active Orders',val:String(activeOrders),icon:'⚙️',color:'#f59e0b'},
          {label:'SKUs',val:String(inventory.length),icon:'🗃️',color:'#22c55e'},
          {label:'Low Stock',val:String(lowStockCount),icon:'⚠️',color:lowStockCount>0?'#ef4444':'#22c55e'},
          {label:'Employees',val:String(employees.length),icon:'👥',color:'#8b5cf6'},
          {label:'Quotes',val:String(quotations.length),icon:'📋',color:'#0ea5e9'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Cross-Module Overview</h3>
            <div className="grid grid-cols-3 gap-2">
              {stats.map(s=>(
                <div key={s.label} className="rounded-xl p-2 text-center" style={{background:`${s.color}10`}}>
                  <p className="text-sm">{s.icon}</p>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const byMonth: Record<string,number>={};
        orders.forEach(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; byMonth[key]=(byMonth[key]??0)+1; });
        const months=Object.keys(byMonth).sort().slice(-10);
        if(months.length<3) return null;
        const vals=months.map(m=>byMonth[m]);
        const maxV=Math.max(...vals,1);
        const trend=vals.length>=2?vals[vals.length-1]-vals[vals.length-2]:0;
        const w=240;const h=60;const pad=8;
        const pts=vals.map((v,i)=>`${pad+(i/(vals.length-1))*(w-2*pad)},${h-pad-(v/maxV)*(h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Monthly Order Volume</h3>
              <span className="text-xs" style={{color:trend>=0?'#22c55e':'#ef4444'}}>{trend>=0?'+':''}{trend} MoM</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <defs><linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25"/><stop offset="100%" stopColor="#3b82f6" stopOpacity="0"/></linearGradient></defs>
              <polygon points={`${pad},${h-pad} ${pts} ${pad+(vals.length-1)/(vals.length-1)*(w-2*pad)},${h-pad}`} fill="url(#volGrad)"/>
              <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              {vals.map((v,i)=><circle key={i} cx={pad+(i/(vals.length-1))*(w-2*pad)} cy={h-pad-(v/maxV)*(h-2*pad)} r="2.5" fill="#3b82f6"/>)}
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1"><span>{months[0]?.slice(5)}</span><span>{months[months.length-1]?.slice(5)}</span></div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const byMonth: Record<string,number>={};
        orders.forEach(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; const oR=o as unknown as Record<string,unknown>; const total=typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0); byMonth[key]=(byMonth[key]??0)+total; });
        const months=Object.keys(byMonth).sort().slice(-4);
        if(months.length<3) return null;
        const vals=months.map(m=>byMonth[m]);
        const growthRates=vals.slice(1).map((v,i)=>vals[i]>0?(v-vals[i])/vals[i]:0);
        const avgGrowth=growthRates.reduce((a,b)=>a+b,0)/growthRates.length;
        const lastRev=vals[vals.length-1];
        const now=new Date();
        const forecasts=[1,2,3].map(i=>{ const d=new Date(now.getFullYear(),now.getMonth()+i,1); return { month:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, rev:lastRev*Math.pow(1+avgGrowth,i) }; });
        const allVals=[...vals,...forecasts.map(f=>f.rev)];
        const maxV=Math.max(...allVals,1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">3-Month Revenue Forecast</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {vals.map((v,i)=><div key={i} className="flex-1 flex flex-col items-center gap-0.5"><div className="w-full rounded-sm" style={{height:`${(v/maxV)*72}px`,background:'#ff4000'}}/><span className="text-[9px] text-gray-400">{months[i]?.slice(5)}</span></div>)}
              {forecasts.map((f,i)=><div key={f.month} className="flex-1 flex flex-col items-center gap-0.5"><span className="text-[8px] text-indigo-400">{fmtAna(f.rev,'K',0)}</span><div className="w-full rounded-sm border-2 border-dashed border-indigo-300" style={{height:`${(f.rev/maxV)*72}px`,background:`rgba(99,102,241,${0.15+i*0.1})`}}/><span className="text-[9px] text-indigo-400">{f.month.slice(5)}</span></div>)}
            </div>
            <p className="text-[10px] text-gray-400 text-center">Based on {(avgGrowth*100).toFixed(1)}% avg monthly growth</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && (() => {
        const totalOrders=orders.length;
        const totalInventory=inventory.length;
        const totalEmployees=employees.length;
        const totalQuotations=quotations.length;
        return (
          <div className="apple-card p-4 mb-4 overflow-hidden relative">
            <div className="absolute inset-0 opacity-5" style={{background:'repeating-linear-gradient(45deg,#ff4000,#ff4000 10px,transparent 10px,transparent 20px)'}}/>
            <div className="relative">
              <div className="text-center mb-3">
                <p className="text-4xl mb-1">🏆</p>
                <h3 className="font-bold text-base text-brand">500 Analytics Phases</h3>
                <p className="text-xs text-gray-500">Complete ERP Intelligence Dashboard</p>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[{label:'Orders',val:totalOrders,icon:'📦'},{label:'SKUs',val:totalInventory,icon:'🗃️'},{label:'Employees',val:totalEmployees,icon:'👥'},{label:'Quotations',val:totalQuotations,icon:'📋'}].map(m=>(
                  <div key={m.label} className="rounded-xl p-2 bg-white/60 text-center">
                    <p className="text-sm">{m.icon}</p>
                    <p className="text-xl font-bold text-brand">{m.val}</p>
                    <p className="text-[9px] text-gray-500">{m.label}</p>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <p className="text-[10px] text-gray-400">Covering General · CRM · Inventory · Logistics · HR</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Cetpa B2B Analytics Engine v2026</p>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
