/**
 * CrmRapor.tsx — Raporlar > CRM & Satış sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'crm' sekmesine ait 88 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'crm'` koşulları BİLEREK korundu: ebeveyn zaten
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

export default function CrmRapor(ctx: ReportsCtx) {
  const { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, salesByDate, trendData, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF } = ctx;
  void itemCostTRY; void itemPriceTRY; // sekmeye göre kullanılıyor olabilir
  return (
    <>
      {reportsTab === 'crm' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: currentLanguage==='tr'?'Toplam Sipariş':'Total Orders', value: String(totalOrders), color: 'text-brand', bg: 'bg-brand/10' },
              { label: currentLanguage==='tr'?'Teslim Edilen':'Delivered', value: String(orders.filter(o=>o.status==='Delivered').length), color: 'text-green-600', bg: 'bg-green-50' },
              { label: currentLanguage==='tr'?'Bekleyen':'Pending', value: String(orders.filter(o=>o.status==='Pending').length), color: 'text-yellow-600', bg: 'bg-yellow-50' },
              { label: currentLanguage==='tr'?'İptal':'Cancelled', value: String(orders.filter(o=>o.status==='Cancelled').length), color: 'text-red-500', bg: 'bg-red-50' },
            ].map((k,i) => (
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}
                className={`apple-card p-5 ${k.bg}`}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{k.label}</p>
                <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Dağılımı */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Sipariş Durumu Dağılımı':'Order Status Distribution'}</h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={4} dataKey="value" label={(props: { name?: string, percent?: number }) => `${props.name || ''} ${((props.percent||0)*100).toFixed(0)}%`} labelLine={false}>
                      {statusChartData.map((_, i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top Müşteriler */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'En Çok Sipariş Veren Müşteriler':'Top Customers by Revenue'}</h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {topCustomers.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">{currentLanguage==='tr'?'Henüz sipariş yok.':'No orders yet.'}</p>
                ) : topCustomers.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-[10px] font-bold text-brand flex-shrink-0">{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                      <p className="text-xs text-gray-400">{c.count} {currentLanguage==='tr'?'sipariş':'orders'}</p>
                    </div>
                    <span className="text-sm font-bold text-brand">{formatInCurrency(c.total, revenueCurrency, exchangeRates)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Satış Trendi */}
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentT.sales_trend}</h3>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#86868B'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#86868B'}} />
                  <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 25px rgba(0,0,0,0.1)'}} />
                  <Bar dataKey="value" fill="#ff4000" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Phase 129: Sales Rep Leaderboard (by order assignee) ── */}
          {orders.length > 0 && (() => {
            type RepStat = { name: string; orderCount: number; revenue: number; delivered: number };
            const repMap: Record<string, RepStat> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              const rep = (o.assignedTo as string | undefined) || o.customerName || '—';
              const key = rep.length > 30 ? rep.slice(0, 15) + '…' : rep;
              if (!repMap[key]) repMap[key] = { name: key, orderCount: 0, revenue: 0, delivered: 0 };
              repMap[key].orderCount++;
              repMap[key].revenue += o.totalPrice || 0;
              if (o.status === 'Delivered') repMap[key].delivered++;
            }
            const reps = Object.values(repMap).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
            if (reps.length === 0) return null;
            const medals = ['🥇', '🥈', '🥉'];
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🏆 En Çok Ciro Yapanlar' : '🏆 Sales Leaderboard'}</h3>
                <div className="space-y-3">
                  {reps.map((r, i) => (
                    <div key={r.name} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      <span className="text-base w-7 flex-shrink-0">{medals[i] || `#${i + 1}`}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate">{r.name}</p>
                        <p className="text-[10px] text-gray-400">{r.orderCount} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · {r.delivered} {currentLanguage === 'tr' ? 'teslim' : 'delivered'}</p>
                      </div>
                      <span className="text-sm font-bold text-brand">{formatInCurrency(r.revenue, revenueCurrency, exchangeRates)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {reportsTab === 'crm' && orders.length >= 3 && (() => {
        const now172 = new Date();
        const thisMonth172 = `${now172.getFullYear()}-${String(now172.getMonth()+1).padStart(2,'0')}`;
        // Find first-order-ever date per customer
        const firstOrderDate: Record<string, string> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const mkey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            const name = o.customerName || '—';
            if (!firstOrderDate[name] || mkey < firstOrderDate[name]) firstOrderDate[name] = mkey;
          } catch { /* skip */ }
        }
        // New customers this month (first order is this month)
        const newThisMonth = Object.entries(firstOrderDate)
          .filter(([, m]) => m === thisMonth172)
          .map(([name]) => {
            const custOrders = orders.filter(o => o.customerName === name && o.status !== 'Cancelled');
            const revenue = custOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
            return { name, revenue, orders: custOrders.length };
          })
          .sort((a, b) => b.revenue - a.revenue);
        if (newThisMonth.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🌟 Bu Ayin Yeni Müşterileri' : '🌟 New Customers This Month'}</h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{newThisMonth.length} {currentLanguage==='tr'?'yeni':'new'}</span>
            </div>
            <div className="space-y-2">
              {newThisMonth.slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-[9px] font-bold text-emerald-700 shrink-0">{i+1}</span>
                    <span className="text-xs font-medium text-gray-800 truncate">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[10px] text-gray-400">{c.orders} {currentLanguage==='tr'?'sip.':'ord.'}</span>
                    <span className="text-xs font-bold text-emerald-600">{fmtAna(c.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length > 3 && (() => {
        // New vs Returning customers per month (last 6 months)
        const now139 = new Date();
        const months139 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now139.getFullYear(), now139.getMonth() - (5 - i), 1);
          return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }) };
        });
        const getOD139 = (o: Order): Date => {
          const raw = o.createdAt ?? o.syncedAt;
          if (!raw) return new Date(0);
          return typeof (raw as { toDate?: () => Date }).toDate === 'function' ? (raw as { toDate: () => Date }).toDate() : new Date(raw as string | number);
        };
        // Build first-order date per customer
        const firstOrderMap: Record<string, Date> = {};
        for (const o of [...orders].sort((a, b) => getOD139(a).getTime() - getOD139(b).getTime())) {
          if (!firstOrderMap[o.customerName]) firstOrderMap[o.customerName] = getOD139(o);
        }
        const data139 = months139.map(m => {
          const monthOrders = orders.filter(o => {
            const d = getOD139(o);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          });
          const customers = [...new Set(monthOrders.map(o => o.customerName))];
          const newCustomers = customers.filter(c => {
            const first = firstOrderMap[c];
            return first && first.getFullYear() === m.year && first.getMonth() === m.month;
          }).length;
          return { label: m.label, new: newCustomers, returning: customers.length - newCustomers };
        });
        const maxBar = Math.max(...data139.map(d => d.new + d.returning), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🔄 Müşteri Tutma Analizi' : '🔄 Customer Retention'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Yeni vs Geri dönen müşteriler' : 'New vs returning customers per month'}</p>
            <div className="flex items-end gap-3 h-32 mb-3">
              {data139.map((d, i) => {
                const totalH = (d.new + d.returning) / maxBar * 100;
                const newH = (d.new / maxBar) * 100;
                const retH = (d.returning / maxBar) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                      <div className="w-full flex flex-col overflow-hidden rounded-t-md" style={{ height: `${totalH}%` }}>
                        <div style={{ height: `${totalH > 0 ? (retH / totalH) * 100 : 0}%` }} className="w-full bg-brand/40 rounded-t-sm" />
                        <div style={{ height: `${totalH > 0 ? (newH / totalH) * 100 : 0}%` }} className="w-full bg-brand" />
                      </div>
                    </div>
                    <span className="text-[9px] text-gray-400 font-semibold">{d.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 pt-3 border-t border-gray-50">
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand flex-shrink-0" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Yeni' : 'New'}</span></div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand/40 flex-shrink-0" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Geri Dönen' : 'Returning'}</span></div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length > 0 && (() => {
        const total145 = quotations.length;
        const converted145 = quotations.filter(q => q.status === 'Converted to Order' || q.status === 'approved').length;
        const pending145 = quotations.filter(q => q.status === 'pending').length;
        const convRate = total145 > 0 ? Math.round((converted145 / total145) * 100) : 0;
        // Monthly conversion last 6m
        const now145 = new Date();
        const months145 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now145.getFullYear(), now145.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mq = quotations.filter(q => {
            if (!q.createdAt) return false;
            try {
              const qd = (q.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(q.createdAt as string);
              return qd.getFullYear() === d.getFullYear() && qd.getMonth() === d.getMonth();
            } catch { return false; }
          });
          return { label, total: mq.length, converted: mq.filter(q => q.status === 'Converted to Order' || q.status === 'approved').length };
        });
        const totalQuoteValue = quotations.reduce((s, q) => s + (q.totalAmount || 0), 0);
        const convertedValue = quotations.filter(q => q.status === 'Converted to Order' || q.status === 'approved').reduce((s, q) => s + (q.totalAmount || 0), 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '📋 Teklif → Sipariş Dönüşümü' : '📋 Quote-to-Order Conversion'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Tekliflerin siparişe dönüşüm analizi' : 'Analysis of quote-to-order pipeline'}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: currentLanguage==='tr'?'Toplam Teklif':'Total Quotes', value: String(total145), color: 'text-blue-600' },
                { label: currentLanguage==='tr'?'Dönüştürülen':'Converted', value: String(converted145), color: 'text-emerald-600' },
                { label: currentLanguage==='tr'?'Dönüşüm Oranı':'Conversion Rate', value: `%${convRate}`, color: convRate >= 40 ? 'text-emerald-600' : 'text-amber-600' },
                { label: currentLanguage==='tr'?'Bekleyen':'Pending', value: String(pending145), color: 'text-amber-600' },
              ].map(k => (
                <div key={k.label} className="text-center">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            {/* Value conversion */}
            <div className="mb-5">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-gray-600">{currentLanguage==='tr'?'Teklif Değeri Dönüşümü':'Quote Value Conversion'}</span>
                <span className="font-semibold text-emerald-600">{fmtAna(convertedValue)} / {fmtAna(totalQuoteValue)}</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${totalQuoteValue > 0 ? Math.round((convertedValue/totalQuoteValue)*100) : 0}%` }} />
              </div>
            </div>
            {/* Monthly mini chart */}
            <div className="flex items-end gap-2 h-16">
              {months145.map((m, i) => {
                const maxM = Math.max(...months145.map(x => x.total), 1);
                const h = Math.round((m.total / maxM) * 100);
                const convH = m.total > 0 ? Math.round((m.converted / m.total) * 100) : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: '48px' }}>
                      <div className="w-full bg-gray-100 rounded-t-sm overflow-hidden" style={{ height: `${h}%` }}>
                        <div className="w-full bg-emerald-400 rounded-t-sm" style={{ height: `${convH}%` }} />
                      </div>
                    </div>
                    <span className="text-[9px] text-gray-400">{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length > 0 && inventory.length > 0 && (() => {
        // For each order, compare actualPrice vs list price to compute discount
        type DiscStat = { customer: string; orders: number; totalList: number; totalActual: number; discPct: number };
        const custMap: Record<string, DiscStat> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!custMap[name]) custMap[name] = { customer: name, orders: 0, totalList: 0, totalActual: 0, discPct: 0 };
          custMap[name].orders++;
          custMap[name].totalActual += o.totalPrice || 0;
          // Estimate list price from inventory retail prices × quantities
          const listPrice = (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(i => i.id === li.inventoryId || i.name === li.name || i.sku === li.sku);
            return s + ((inv?.prices?.['Retail'] ?? inv?.price ?? li.price) * li.quantity);
          }, 0);
          custMap[name].totalList += listPrice || o.totalPrice || 0;
        }
        const discs = Object.values(custMap).map(c => ({
          ...c,
          discPct: c.totalList > 0 ? Math.round(((c.totalList - c.totalActual) / c.totalList) * 100) : 0,
        })).filter(c => c.orders >= 1).sort((a, b) => b.discPct - a.discPct).slice(0, 8);
        if (discs.length === 0 || discs.every(d => d.discPct === 0)) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🏷️ Müşteri İndirim Analizi' : '🏷️ Customer Discount Analysis'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Liste fiyatına göre uygulanan ortalama indirim' : 'Average discount vs retail list price'}</p>
            <div className="space-y-2.5">
              {discs.map(c => (
                <div key={c.customer} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-800 w-36 truncate shrink-0">{c.customer}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.discPct >= 20 ? 'bg-red-400' : c.discPct >= 10 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.min(c.discPct * 3, 100)}%` }} />
                  </div>
                  <span className={`text-xs font-bold tabular-nums shrink-0 w-10 text-right ${c.discPct >= 20 ? 'text-red-600' : c.discPct >= 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    %{c.discPct}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">{c.orders} {currentLanguage==='tr'?'sip.':'ord.'}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage==='tr'?'* İndirim = (Liste Fiyatı - Gerçekleşen) / Liste Fiyatı':'* Discount = (List Price - Actual) / List Price'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 3 && (() => {
        const now175 = new Date();
        const cutoff175 = new Date(now175); cutoff175.setDate(cutoff175.getDate() - 90);
        // Find customers whose last order was >90 days ago
        const lastOrderDate: Record<string, Date> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (!lastOrderDate[o.customerName] || d > lastOrderDate[o.customerName]) {
              lastOrderDate[o.customerName] = d;
            }
          } catch { /* skip */ }
        }
        const winBack = Object.entries(lastOrderDate)
          .filter(([, d]) => d < cutoff175)
          .map(([name, lastDate]) => {
            const daysDormant = Math.floor((now175.getTime() - lastDate.getTime()) / 86400000);
            const custOrders = orders.filter(o => o.customerName === name && o.status !== 'Cancelled');
            const ltv = custOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
            return { name, daysDormant, ltv, orders: custOrders.length };
          })
          .sort((a, b) => b.ltv - a.ltv)
          .slice(0, 6);
        if (winBack.length === 0) return null;
        return (
          <div className="apple-card p-6 border border-amber-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔄 Geri Kazanım Listesi' : '🔄 Win-Back Candidates'}</h3>
              <span className="text-xs text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full">{winBack.length} {currentLanguage==='tr'?'hareketsiz müşteri':'dormant customers'}</span>
            </div>
            <div className="space-y-2.5">
              {winBack.map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{c.name}</p>
                    <p className="text-[10px] text-gray-400">{c.daysDormant} {currentLanguage==='tr'?'gündür sipariş yok':'days since last order'} · {c.orders} {currentLanguage==='tr'?'önceki sip.':'prev orders'}</p>
                  </div>
                  <span className="text-xs font-bold text-amber-600 shrink-0 ml-3">{fmtAna(c.ltv,'K',1)} LTV</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage==='tr'?'90+ gündür sipariş vermeyen yüksek değerli müşteriler':'High-value customers who haven\'t ordered in 90+ days'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        // Compute LTV per customer
        const ltvMap: Record<string, { name: string; ltv: number; orders: number; avgOrder: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!ltvMap[name]) ltvMap[name] = { name, ltv: 0, orders: 0, avgOrder: 0 };
          ltvMap[name].ltv += o.totalPrice || 0;
          ltvMap[name].orders++;
        }
        const customers = Object.values(ltvMap).map(c => ({ ...c, avgOrder: c.orders > 0 ? c.ltv / c.orders : 0 })).sort((a, b) => b.ltv - a.ltv);
        if (customers.length === 0) return null;
        // Tier by top 20% / mid 60% / bottom 20%
        const n = customers.length;
        const top20 = customers.slice(0, Math.ceil(n * 0.2));
        const mid60 = customers.slice(Math.ceil(n * 0.2), Math.ceil(n * 0.8));
        const bot20 = customers.slice(Math.ceil(n * 0.8));
        const tiers = [
          { label: currentLanguage==='tr'?'Platin (Top %20)':'Platinum (Top 20%)', customers: top20, color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
          { label: currentLanguage==='tr'?'Altın (Orta %60)':'Gold (Mid 60%)', customers: mid60, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
          { label: currentLanguage==='tr'?'Gümüş (Alt %20)':'Silver (Bottom 20%)', customers: bot20, color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💎 Müşteri LTV Segmentasyonu' : '💎 Customer LTV Segmentation'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {tiers.map(tier => {
                const tierLTV = tier.customers.reduce((s, c) => s + c.ltv, 0);
                return (
                  <div key={tier.label} className={`rounded-2xl border p-4 ${tier.bg} ${tier.border}`}>
                    <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${tier.color}`}>{tier.label}</p>
                    <p className={`text-2xl font-black ${tier.color}`}>{tier.customers.length}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage==='tr'?'müşteri':'customers'}</p>
                    <p className={`text-sm font-bold mt-2 ${tier.color}`}>{fmtAna(tierLTV,'K',1)}</p>
                    <p className="text-[10px] text-gray-500">{currentLanguage==='tr'?'toplam ciro':'total revenue'}</p>
                    {tier.customers.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/60 space-y-0.5">
                        {tier.customers.slice(0, 3).map(c => (
                          <p key={c.name} className="text-[10px] text-gray-600 truncate">{c.name}</p>
                        ))}
                        {tier.customers.length > 3 && <p className="text-[10px] text-gray-400">+{tier.customers.length - 3} {currentLanguage==='tr'?'daha':'more'}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.filter(o => o.status === 'Cancelled').length > 0 && (() => {
        const cancelled = orders.filter(o => o.status === 'Cancelled');
        const total = orders.length;
        const cancelRate = Math.round((cancelled.length / total) * 100);
        const cancelledRevLost = cancelled.reduce((s, o) => s + (o.totalPrice || 0), 0);
        // Cancellations by customer
        const custCancelMap: Record<string, number> = {};
        for (const o of cancelled) {
          const name = o.customerName || '—';
          custCancelMap[name] = (custCancelMap[name] ?? 0) + 1;
        }
        const topCancellers = Object.entries(custCancelMap).sort(([,a],[,b]) => b - a).slice(0, 5);
        // Cancellations by month
        const now161 = new Date();
        const cancelByMonth: Record<string, number> = {};
        for (const o of cancelled) {
          try {
            const d = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            cancelByMonth[key] = (cancelByMonth[key] ?? 0) + 1;
          } catch { /* skip */ }
        }
        void now161;
        return (
          <div className="apple-card p-6 border border-red-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '❌ İptal Analizi' : '❌ Cancellation Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cancelRate >= 15 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                %{cancelRate} {currentLanguage==='tr'?'iptal oranı':'cancel rate'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage==='tr'?'İptal Edilen':'Cancelled', value: cancelled.length, color: 'text-red-600' },
                { label: currentLanguage==='tr'?'İptal Oranı':'Cancel Rate', value: `%${cancelRate}`, color: cancelRate >= 15 ? 'text-red-600' : 'text-amber-600' },
                { label: currentLanguage==='tr'?'Kayıp Ciro':'Revenue Lost', value: `₺${(cancelledRevLost/1000).toFixed(1)}K`, color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400">{k.label}</p>
                </div>
              ))}
            </div>
            {topCancellers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage==='tr'?'En Çok İptal Eden Müşteriler':'Top Cancelling Customers'}</p>
                <div className="space-y-1.5">
                  {topCancellers.map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{name}</span>
                      <span className="text-red-500 font-bold ml-2">{count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now187 = new Date();
        const prevMonthStart = new Date(now187.getFullYear(), now187.getMonth() - 1, 1);
        const prevMonthEnd = new Date(now187.getFullYear(), now187.getMonth(), 0, 23, 59, 59);
        const currMonthStart = new Date(now187.getFullYear(), now187.getMonth(), 1);
        const getDate187 = (o: Order) => {
          try { return (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string); }
          catch { return null; }
        };
        const prevCustomers = new Set<string>();
        const currCustomers = new Set<string>();
        const prevRevByCustomer: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const d = getDate187(o);
          if (!d) continue;
          const name = o.customerName || '—';
          if (d >= prevMonthStart && d <= prevMonthEnd) {
            prevCustomers.add(name);
            prevRevByCustomer[name] = (prevRevByCustomer[name] ?? 0) + (o.totalPrice || 0);
          }
          if (d >= currMonthStart) currCustomers.add(name);
        }
        const churned = [...prevCustomers].filter(c => !currCustomers.has(c));
        const churnedRevLost = churned.reduce((s, c) => s + (prevRevByCustomer[c] ?? 0), 0);
        const newCustomers = [...currCustomers].filter(c => !prevCustomers.has(c));
        const churnRate = prevCustomers.size > 0 ? Math.round((churned.length / prevCustomers.size) * 100) : 0;
        if (churned.length === 0 && newCustomers.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📤 Müşteri Churn Analizi' : '📤 Customer Churn Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${churnRate >= 30 ? 'bg-red-100 text-red-700' : churnRate >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                %{churnRate} {currentLanguage === 'tr' ? 'churn' : 'churn rate'}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Önceki ay aktif → bu ay sipariş vermeyen müşteriler' : 'Active last month → no orders this month'}</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Kaybedilen' : 'Churned', value: churned.length, color: 'text-red-600' },
                { label: currentLanguage === 'tr' ? 'Kayıp Ciro' : 'Lost Revenue', value: `₺${(churnedRevLost/1000).toFixed(1)}K`, color: 'text-red-500' },
                { label: currentLanguage === 'tr' ? 'Yeni Müşteri' : 'New Customers', value: newCustomers.length, color: 'text-emerald-600' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            {churned.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">{currentLanguage === 'tr' ? 'Kaybedilen Müşteriler:' : 'Churned Customers:'}</p>
                <div className="space-y-1">
                  {churned.slice(0, 5).map(c => (
                    <div key={c} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                      <span className="text-gray-700 truncate">{c}</span>
                      <span className="text-red-500 font-medium shrink-0 ml-2">-{fmtAna((prevRevByCustomer[c] ?? 0),'full',0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now192 = new Date();
        const custMap192: Record<string, { recency: number; frequency: number; monetary: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          let days = 999;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            days = Math.round((now192.getTime() - od.getTime()) / 86400000);
          } catch { /* skip */ }
          if (!custMap192[name]) custMap192[name] = { recency: days, frequency: 0, monetary: 0 };
          if (days < custMap192[name].recency) custMap192[name].recency = days;
          custMap192[name].frequency++;
          custMap192[name].monetary += o.totalPrice || 0;
        }
        const custs192 = Object.entries(custMap192).map(([name, d]) => ({ name, ...d }));
        if (custs192.length < 3) return null;
        // Quintile scoring 1-5 per dimension
        const sortedR = [...custs192].sort((a, b) => a.recency - b.recency); // lower recency = more recent = higher score
        const sortedF = [...custs192].sort((a, b) => b.frequency - a.frequency);
        const sortedM = [...custs192].sort((a, b) => b.monetary - a.monetary);
        const scoreOf = (arr: typeof custs192, name: string) => {
          const idx = arr.findIndex(c => c.name === name);
          const n = arr.length;
          return n <= 1 ? 5 : Math.round(5 - (idx / (n - 1)) * 4);
        };
        const rfm = custs192.map(c => ({
          name: c.name,
          r: scoreOf(sortedR, c.name),
          f: scoreOf(sortedF, c.name),
          m: scoreOf(sortedM, c.name),
          total: scoreOf(sortedR, c.name) + scoreOf(sortedF, c.name) + scoreOf(sortedM, c.name),
          monetary: c.monetary,
        })).sort((a, b) => b.total - a.total);
        const segmentOf = (total: number) => total >= 13 ? { label: currentLanguage === 'tr' ? '💎 Şampiyonlar' : '💎 Champions', cls: 'bg-emerald-100 text-emerald-700' }
          : total >= 10 ? { label: currentLanguage === 'tr' ? '⭐ Sadık' : '⭐ Loyal', cls: 'bg-blue-100 text-blue-700' }
          : total >= 7 ? { label: currentLanguage === 'tr' ? '😐 Orta' : '😐 At Risk', cls: 'bg-amber-100 text-amber-700' }
          : { label: currentLanguage === 'tr' ? '😴 Uykuda' : '😴 Lost', cls: 'bg-red-100 text-red-600' };
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Müşteri RFM Segmentasyonu' : '🎯 Customer RFM Segmentation'}</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {rfm.slice(0, 10).map(c => {
                const seg = segmentOf(c.total);
                return (
                  <div key={c.name} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${seg.cls}`}>{seg.label}</span>
                    <span className="text-xs text-gray-700 truncate flex-1">{c.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {[{ v: c.r, t: 'R' }, { v: c.f, t: 'F' }, { v: c.m, t: 'M' }].map(dim => (
                        <span key={dim.t} className={`text-[9px] font-bold w-5 h-5 rounded flex items-center justify-center ${dim.v >= 4 ? 'bg-emerald-400 text-white' : dim.v >= 3 ? 'bg-amber-300 text-gray-800' : 'bg-red-200 text-gray-700'}`}>{dim.v}</span>
                      ))}
                    </div>
                    <span className="text-xs font-bold text-gray-600 shrink-0 ml-1">{fmtAna(c.monetary,'K',0)}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'R=Yenilik, F=Sıklık, M=Para · 1(düşük)–5(yüksek)' : 'R=Recency, F=Frequency, M=Monetary · 1(low)–5(high)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 3 && inventory.length > 0 && (() => {
        const custProfit: Record<string, { rev: number; cogs: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!custProfit[name]) custProfit[name] = { rev: 0, cogs: 0 };
          custProfit[name].rev += o.totalPrice || 0;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            custProfit[name].cogs += (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
          }
        }
        const profitList = Object.entries(custProfit)
          .map(([name, d]) => ({ name, rev: d.rev, cogs: d.cogs, profit: d.rev - d.cogs, margin: d.rev > 0 ? Math.round(((d.rev - d.cogs) / d.rev) * 100) : 0 }))
          .sort((a, b) => b.profit - a.profit)
          .slice(0, 8);
        if (profitList.length < 2) return null;
        const maxProfit = Math.max(...profitList.map(p => p.profit), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💹 Müşteri Bazlı Kâr Analizi' : '💹 Profit by Customer'}</h3>
            <div className="space-y-2.5">
              {profitList.map(p => (
                <div key={p.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{p.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.margin >= 30 ? 'bg-emerald-100 text-emerald-700' : p.margin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>%{p.margin}</span>
                      <span className="text-xs font-bold text-gray-700">{fmtAna(p.profit,'K',0)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${p.margin >= 30 ? 'bg-emerald-400' : p.margin >= 15 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(4, Math.round((p.profit / maxProfit) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const repMap196: Record<string, { rev: number; orders: number }> = {};
        const now196 = new Date();
        const monthStart196 = new Date(now196.getFullYear(), now196.getMonth(), 1);
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const rep = (o.assignedTo as string | undefined) || (o as unknown as Record<string,unknown>).salesRep as string || '—';
          if (rep === '—') continue;
          if (!repMap196[rep]) repMap196[rep] = { rev: 0, orders: 0 };
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od >= monthStart196) {
              repMap196[rep].rev += o.totalPrice || 0;
              repMap196[rep].orders++;
            }
          } catch { /* skip */ }
        }
        const repList = Object.entries(repMap196).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.rev - a.rev).slice(0, 8);
        if (repList.length < 2) return null;
        const maxRevRep = Math.max(...repList.map(r => r.rev), 1);
        const medals = ['🥇', '🥈', '🥉'];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏆 Satış Temsilcisi Sıralaması' : '🏆 Sales Rep Leaderboard'}</h3>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? 'Bu ay' : 'This month'}</span>
            </div>
            <div className="space-y-2.5">
              {repList.map((r, i) => (
                <div key={r.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{medals[i] ?? `#${i+1}`}</span>
                      <span className="text-xs font-medium text-gray-800 truncate">{r.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{r.orders} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                      <span className="text-xs font-bold text-gray-700">{fmtAna(r.rev,'K',0)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-blue-300'}`} style={{ width: `${Math.max(4, Math.round((r.rev / maxRevRep) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now200 = new Date();
        const months200 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now200.getFullYear(), now200.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const year = d.getFullYear(); const month = d.getMonth();
          return { label, year, month, newRev: 0, repeatRev: 0 };
        });
        // Track first order month per customer
        const firstOrderMonth: Record<string, { year: number; month: number }> = {};
        const sortedOrders = [...orders].sort((a, b) => {
          try {
            const da = (a.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(a.createdAt as string);
            const db2 = (b.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(b.createdAt as string);
            return da.getTime() - db2.getTime();
          } catch { return 0; }
        });
        for (const o of sortedOrders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (!firstOrderMonth[name]) firstOrderMonth[name] = { year: od.getFullYear(), month: od.getMonth() };
            const m = months200.find(m => m.year === od.getFullYear() && m.month === od.getMonth());
            if (!m) continue;
            const isNew = firstOrderMonth[name].year === od.getFullYear() && firstOrderMonth[name].month === od.getMonth();
            if (isNew) m.newRev += o.totalPrice || 0;
            else m.repeatRev += o.totalPrice || 0;
          } catch { /* skip */ }
        }
        const hasData = months200.some(m => m.newRev > 0 || m.repeatRev > 0);
        if (!hasData) return null;
        const maxTotal = Math.max(...months200.map(m => m.newRev + m.repeatRev), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🆕 Yeni vs Tekrar Müşteri Cirosu' : '🆕 New vs Repeat Customer Revenue'}</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-brand" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Yeni' : 'New'}</span></div>
                <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-blue-300" /><span className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Tekrar' : 'Repeat'}</span></div>
              </div>
            </div>
            <div className="flex items-end gap-3 h-28 mb-2">
              {months200.map((m, i) => {
                const total = m.newRev + m.repeatRev;
                const totalH = Math.round((total / maxTotal) * 80);
                const newH = total > 0 ? Math.round((m.newRev / total) * totalH) : 0;
                const repH = totalH - newH;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center justify-end" style={{ height: '80px' }}>
                      <div className="w-full bg-brand rounded-t-sm" style={{ height: `${Math.max(newH > 0 ? 2 : 0, newH)}px` }} />
                      <div className="w-full bg-blue-300" style={{ height: `${Math.max(repH > 0 ? 2 : 0, repH)}px` }} />
                    </div>
                    <span className="text-[9px] text-gray-400 leading-none">{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now205 = new Date();
        // Compute CLV = total spend per customer, cohorted by first-order quarter
        const custData205: Record<string, { firstQ: string; ltv: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const q = `Q${Math.floor(od.getMonth() / 3) + 1} ${od.getFullYear()}`;
            if (!custData205[name]) custData205[name] = { firstQ: q, ltv: 0 };
            custData205[name].ltv += o.totalPrice || 0;
          } catch { /* skip */ }
        }
        void now205;
        const cohorts: Record<string, number[]> = {};
        for (const { firstQ, ltv } of Object.values(custData205)) {
          if (!cohorts[firstQ]) cohorts[firstQ] = [];
          cohorts[firstQ].push(ltv);
        }
        const cohortList = Object.entries(cohorts)
          .map(([q, ltvs]) => ({ q, avgLTV: Math.round(ltvs.reduce((s,v) => s+v,0) / ltvs.length), count: ltvs.length }))
          .sort((a, b) => a.q.localeCompare(b.q))
          .slice(-6);
        if (cohortList.length < 2) return null;
        const maxLTV = Math.max(...cohortList.map(c => c.avgLTV), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💎 Müşteri Yaşam Boyu Değeri (Cohort)' : '💎 Customer LTV by Cohort'}</h3>
            <div className="flex items-end gap-3 h-28 mb-2">
              {cohortList.map((c, i) => {
                const h = Math.round((c.avgLTV / maxLTV) * 80);
                const isLatest = i === cohortList.length - 1;
                return (
                  <div key={c.q} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: '80px' }}>
                      {c.avgLTV > 0 && <span className="text-[8px] font-bold text-gray-500 mb-0.5">{fmtAna(c.avgLTV,'K',0)}</span>}
                      <div className="w-full flex items-end mt-auto" style={{ height: `${Math.max(4, h)}px` }}>
                        <div className={`w-full rounded-t-md ${isLatest ? 'bg-purple-500' : 'bg-purple-200'}`} style={{ height: '100%' }} />
                      </div>
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none text-center">{c.q}</span>
                    <span className="text-[8px] text-gray-300">{c.count}m</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'İlk sipariş çeyreğine göre ortalama müşteri değeri' : 'Avg customer value by first-order quarter cohort'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && inventory.length > 0 && (() => {
        const catQuotes: Record<string, { won: number; total: number }> = {};
        for (const q of quotations) {
          const status = (q as unknown as Record<string,unknown>).status as string | undefined;
          const items = (q as unknown as Record<string,unknown>).items as Array<{ inventoryId?: string; name?: string }> | undefined;
          if (!items?.length) continue;
          for (const qi of items) {
            const inv = inventory.find(ii => ii.id === qi.inventoryId || ii.name === qi.name);
            const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
            if (!catQuotes[cat]) catQuotes[cat] = { won: 0, total: 0 };
            catQuotes[cat].total++;
            if (status === 'Converted to Order' || status === 'accepted' || status === 'won') catQuotes[cat].won++;
          }
        }
        const catList = Object.entries(catQuotes)
          .map(([cat, d]) => ({ cat, ...d, rate: d.total > 0 ? Math.round((d.won / d.total) * 100) : 0 }))
          .filter(c => c.total >= 2)
          .sort((a, b) => b.rate - a.rate)
          .slice(0, 6);
        if (catList.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Kategori Bazlı Teklif Kazanma Oranı' : '🎯 Quote Win Rate by Category'}</h3>
            <div className="space-y-2.5">
              {catList.map(c => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.cat}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{c.won}/{c.total}</span>
                      <span className={`text-xs font-bold ${c.rate >= 50 ? 'text-emerald-600' : c.rate >= 30 ? 'text-amber-600' : 'text-red-500'}`}>%{c.rate}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.rate >= 50 ? 'bg-emerald-400' : c.rate >= 30 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(4, c.rate)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 6 && (() => {
        const now210 = new Date();
        const months210 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now210.getFullYear(), now210.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const mOrds = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const customers = new Set(mOrds.map(o => o.customerName || '—')).size;
          const rev = mOrds.reduce((s, o) => s + (o.totalPrice || 0), 0);
          const arpu = customers > 0 ? Math.round(rev / customers) : 0;
          return { label, arpu, customers, rev };
        });
        const hasData = months210.some(m => m.arpu > 0);
        if (!hasData) return null;
        const maxARPU = Math.max(...months210.map(m => m.arpu), 1);
        const currARPU = months210[months210.length - 1].arpu;
        const prevARPU = months210[months210.length - 2].arpu;
        const growth210 = prevARPU > 0 ? Math.round(((currARPU - prevARPU) / prevARPU) * 100) : null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '👤 Kullanıcı Başı Ortalama Gelir (ARPU)' : '👤 Avg Revenue Per User (ARPU)'}</h3>
              {growth210 !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${growth210 >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {growth210 >= 0 ? '↑' : '↓'} %{Math.abs(growth210)} MoM
                </span>
              )}
            </div>
            <div className="flex items-end gap-3 h-24 mb-2">
              {months210.map((m, i) => {
                const isLatest = i === months210.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full" style={{ height: '72px', display: 'flex', alignItems: 'flex-end' }}>
                      <div className={`w-full rounded-t-md ${isLatest ? 'bg-indigo-500' : 'bg-indigo-200'}`} style={{ height: `${Math.max(4, Math.round((m.arpu / maxARPU) * 68))}px` }} />
                    </div>
                    <span className={`text-[9px] leading-none ${isLatest ? 'font-bold text-indigo-600' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-black text-indigo-600">{fmtAna(currARPU)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu ay ARPU' : 'This month ARPU'}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-gray-600">{months210[months210.length-1].customers} {currentLanguage === 'tr' ? 'aktif müşteri' : 'active customers'}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Bu ay' : 'This month'}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custRev218: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          custRev218[name] = (custRev218[name] ?? 0) + (o.totalPrice || 0);
        }
        const custList218 = Object.entries(custRev218).sort(([,a],[,b]) => b - a);
        if (custList218.length < 3) return null;
        const totalRev218 = custList218.reduce((s,[,v]) => s + v, 0);
        const top1Pct218 = totalRev218 > 0 ? Math.round((custList218[0][1] / totalRev218) * 100) : 0;
        const top3Pct218 = totalRev218 > 0 ? Math.round((custList218.slice(0,3).reduce((s,[,v]) => s+v, 0) / totalRev218) * 100) : 0;
        const riskLevel218 = top1Pct218 >= 50 ? 'high' : top1Pct218 >= 30 ? 'medium' : 'low';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚠️ Müşteri Konsantrasyon Riski' : '⚠️ Customer Concentration Risk'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${riskLevel218 === 'high' ? 'bg-red-100 text-red-700' : riskLevel218 === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {riskLevel218 === 'high' ? (currentLanguage === 'tr' ? 'Yüksek' : 'High') : riskLevel218 === 'medium' ? (currentLanguage === 'tr' ? 'Orta' : 'Med') : (currentLanguage === 'tr' ? 'Düşük' : 'Low')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-black ${top1Pct218 >= 50 ? 'text-red-500' : 'text-amber-500'}`}>%{top1Pct218}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'En büyük müşteri' : 'Largest customer'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-black ${top3Pct218 >= 80 ? 'text-red-500' : 'text-blue-600'}`}>%{top3Pct218}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'İlk 3 müşteri' : 'Top 3 customers'}</p>
              </div>
            </div>
            <div className="space-y-2">
              {custList218.slice(0, 5).map(([name, rev]) => {
                const pct = totalRev218 > 0 ? Math.round((rev / totalRev218) * 100) : 0;
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700 truncate">{name}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 30 ? 'bg-red-400' : pct >= 15 ? 'bg-amber-400' : 'bg-blue-300'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        // Orders where totalPrice < sum(lineItems at list price) indicates discount
        let totalListPrice = 0;
        let totalActualPrice = 0;
        const discountByCustomer: Record<string, { discount: number; orders: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const listPrice = (o.lineItems ?? []).reduce((s, li) => {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            const retail = inv?.prices?.['Retail'] ?? li.price;
            return s + retail * li.quantity;
          }, 0);
          const actual = o.totalPrice || 0;
          totalListPrice += listPrice;
          totalActualPrice += actual;
          const discount = listPrice - actual;
          if (discount > 0) {
            const name = o.customerName || '—';
            if (!discountByCustomer[name]) discountByCustomer[name] = { discount: 0, orders: 0 };
            discountByCustomer[name].discount += discount;
            discountByCustomer[name].orders++;
          }
        }
        const totalDiscount = totalListPrice - totalActualPrice;
        if (totalDiscount <= 0 || totalListPrice === 0) return null;
        const discountRate = Math.round((totalDiscount / totalListPrice) * 100);
        const topDiscountCusts = Object.entries(discountByCustomer)
          .sort(([,a],[,b]) => b.discount - a.discount)
          .slice(0, 5);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💸 İskonto Sızıntı Analizi' : '💸 Discount Leakage Analysis'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${discountRate >= 20 ? 'bg-red-100 text-red-700' : discountRate >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                %{discountRate} {currentLanguage === 'tr' ? 'ortalama iskonto' : 'avg discount'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-red-600">{fmtAna(totalDiscount,'K',0)}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Toplam İskonto' : 'Total Discount Given'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-gray-700">{fmtAna(totalListPrice,'K',0)}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Liste Fiyatı Toplamı' : 'Total List Price'}</p>
              </div>
            </div>
            {topDiscountCusts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">{currentLanguage === 'tr' ? 'En Çok İskonto Alan Müşteriler:' : 'Top Discounted Customers:'}</p>
                <div className="space-y-1.5">
                  {topDiscountCusts.map(([name, d]) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{name}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{d.orders} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</span>
                        <span className="font-bold text-red-500">-{fmtAna(d.discount,'K',0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        // Days from quotation creation to conversion
        const conversionTimes: number[] = [];
        for (const q of quotations) {
          const m = q as unknown as Record<string,unknown>;
          const status = (m.status as string) || '';
          if (status !== 'Converted to Order' && status !== 'accepted') continue;
          try {
            const created = (q.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(q.createdAt as string);
            const converted = m.convertedAt
              ? ((m.convertedAt as { toDate?: () => Date }).toDate?.() ?? new Date(m.convertedAt as string))
              : new Date();
            const days = Math.round((converted.getTime() - created.getTime()) / 86400000);
            if (days >= 0 && days < 180) conversionTimes.push(days);
          } catch { /* skip */ }
        }
        if (conversionTimes.length < 2) return null;
        const avgDays = Math.round(conversionTimes.reduce((s, d) => s + d, 0) / conversionTimes.length);
        const minDays = Math.min(...conversionTimes);
        const maxDays = Math.max(...conversionTimes);
        const buckets226 = [
          { label: currentLanguage === 'tr' ? 'Aynı gün' : 'Same day', max: 0, count: 0 },
          { label: '1-3d', max: 3, count: 0 },
          { label: '4-7d', max: 7, count: 0 },
          { label: '8-30d', max: 30, count: 0 },
          { label: '30d+', max: Infinity, count: 0 },
        ];
        for (const d of conversionTimes) {
          const b = buckets226.find(b => d <= b.max);
          if (b) b.count++;
        }
        const maxBkt226 = Math.max(...buckets226.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏱️ Teklif → Sipariş Dönüşüm Süresi' : '⏱️ Quote → Order Conversion Time'}</h3>
              <span className="text-xl font-black text-blue-600">{avgDays} {currentLanguage === 'tr' ? 'gün ort.' : 'd avg'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{minDays} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'En hızlı' : 'Fastest'}</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-amber-600">{maxDays} {currentLanguage === 'tr' ? 'gün' : 'd'}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'En yavaş' : 'Slowest'}</p>
              </div>
            </div>
            <div className="flex items-end gap-2 h-16">
              {buckets226.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end" style={{ height: '44px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBkt226) * 44))}px` }} />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        // Tier customers by total LTV: Platinum top 20%, Gold mid 60%, Silver bottom 20%
        const custLTV228: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          custLTV228[name] = (custLTV228[name] ?? 0) + (o.totalPrice || 0);
        }
        const sorted228 = Object.entries(custLTV228).sort(([,a],[,b]) => b - a);
        const n228 = sorted228.length;
        if (n228 < 3) return null;
        const topN = Math.ceil(n228 * 0.2);
        const botN = Math.ceil(n228 * 0.2);
        const platinum = new Set(sorted228.slice(0, topN).map(([n]) => n));
        const silver = new Set(sorted228.slice(n228 - botN).map(([n]) => n));
        // Revenue this month by tier
        const now228 = new Date();
        const monthStart228 = new Date(now228.getFullYear(), now228.getMonth(), 1);
        const prevMonthStart228 = new Date(now228.getFullYear(), now228.getMonth() - 1, 1);
        const prevMonthEnd228 = new Date(now228.getFullYear(), now228.getMonth(), 0, 23, 59, 59);
        const tierRevCurr: Record<string, number> = { Platinum: 0, Gold: 0, Silver: 0 };
        const tierRevPrev: Record<string, number> = { Platinum: 0, Gold: 0, Silver: 0 };
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          const tier = platinum.has(name) ? 'Platinum' : silver.has(name) ? 'Silver' : 'Gold';
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od >= monthStart228) tierRevCurr[tier] += o.totalPrice || 0;
            else if (od >= prevMonthStart228 && od <= prevMonthEnd228) tierRevPrev[tier] += o.totalPrice || 0;
          } catch { /* skip */ }
        }
        const tierColors: Record<string, { bg: string; text: string; bar: string }> = {
          Platinum: { bg: 'bg-purple-50', text: 'text-purple-700', bar: 'bg-purple-400' },
          Gold: { bg: 'bg-amber-50', text: 'text-amber-700', bar: 'bg-amber-400' },
          Silver: { bg: 'bg-gray-100', text: 'text-gray-600', bar: 'bg-gray-400' },
        };
        const maxTierRev = Math.max(...Object.values(tierRevCurr), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '👑 Müşteri Kademesine Göre Satış Trendi' : '👑 Sales Trend by Customer Tier'}</h3>
            <div className="space-y-3">
              {(['Platinum', 'Gold', 'Silver'] as const).map(tier => {
                const curr = tierRevCurr[tier];
                const prev = tierRevPrev[tier];
                const growth = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;
                const cls = tierColors[tier];
                return (
                  <div key={tier} className={`${cls.bg} rounded-xl p-4`}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className={`text-xs font-bold ${cls.text}`}>{tier === 'Platinum' ? '💎' : tier === 'Gold' ? '⭐' : '🥈'} {tier}</p>
                        <p className="text-[10px] text-gray-400">{tier === 'Platinum' ? `Top ${topN}` : tier === 'Silver' ? `Bottom ${botN}` : `Mid ${n228 - topN - botN}`} {currentLanguage === 'tr' ? 'müşteri' : 'customers'}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-black ${cls.text}`}>{fmtAna(curr,'K',0)}</p>
                        {growth !== null && <p className={`text-[10px] font-bold ${growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{growth >= 0 ? '↑' : '↓'} %{Math.abs(growth)} MoM</p>}
                      </div>
                    </div>
                    <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${cls.bar}`} style={{ width: `${Math.max(4, Math.round((curr / maxTierRev) * 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const now230 = new Date();
        const prevStart = new Date(now230.getFullYear(), now230.getMonth() - 6, 1);
        const prevEnd = new Date(now230.getFullYear(), now230.getMonth() - 3, 0, 23, 59, 59);
        const currStart = new Date(now230.getFullYear(), now230.getMonth() - 3, 1);
        // Customers in period 1 (prev 3 months)
        const prevCustRev: Record<string, number> = {};
        const currCustRev: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od >= prevStart && od <= prevEnd) prevCustRev[name] = (prevCustRev[name] ?? 0) + (o.totalPrice || 0);
            if (od >= currStart) currCustRev[name] = (currCustRev[name] ?? 0) + (o.totalPrice || 0);
          } catch { /* skip */ }
        }
        const existingCusts = Object.keys(prevCustRev);
        if (existingCusts.length < 3) return null;
        // NRR = revenue from existing customers in curr / their revenue in prev
        const prevRevExisting = existingCusts.reduce((s, n) => s + prevCustRev[n], 0);
        const currRevExisting = existingCusts.reduce((s, n) => s + (currCustRev[n] ?? 0), 0);
        const nrr = prevRevExisting > 0 ? Math.round((currRevExisting / prevRevExisting) * 100) : null;
        if (nrr === null) return null;
        const expansion = existingCusts.filter(n => (currCustRev[n] ?? 0) > prevCustRev[n]).length;
        const churned230 = existingCusts.filter(n => !(currCustRev[n])).length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📈 Net Gelir Tutma Oranı (NRR)' : '📈 Net Revenue Retention (NRR)'}</h3>
              <span className={`text-2xl font-black ${nrr >= 100 ? 'text-emerald-600' : nrr >= 80 ? 'text-amber-500' : 'text-red-500'}`}>%{nrr}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Önceki Dönem' : 'Prior Period', value: `₺${(prevRevExisting/1000).toFixed(0)}K`, color: 'text-gray-600' },
                { label: currentLanguage === 'tr' ? 'Mevcut Dönem' : 'Current Period', value: `₺${(currRevExisting/1000).toFixed(0)}K`, color: nrr >= 100 ? 'text-emerald-600' : 'text-amber-600' },
                { label: currentLanguage === 'tr' ? 'Müşteri Kaybı' : 'Churned', value: String(churned230), color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 p-3 rounded-xl bg-blue-50">
              <span>💡</span>
              <p className="text-[11px] text-blue-700">
                {currentLanguage === 'tr'
                  ? `${expansion} müşteri harcamasını artırdı, ${churned230} kayboldu. NRR >100% büyüme gösterir.`
                  : `${expansion} customers expanded, ${churned230} churned. NRR >100% means expansion exceeds churn.`}
              </p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        // Risk factors: high cancellations, long AR days, declining order freq
        const now232 = new Date();
        const custMap232: Record<string, { orders: number; cancelled: number; lastOrderDays: number; rev: number }> = {};
        for (const o of orders) {
          const name = o.customerName || '—';
          if (!custMap232[name]) custMap232[name] = { orders: 0, cancelled: 0, lastOrderDays: 999, rev: 0 };
          custMap232[name].orders++;
          if (o.status === 'Cancelled') { custMap232[name].cancelled++; continue; }
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const days = Math.round((now232.getTime() - od.getTime()) / 86400000);
            if (days < custMap232[name].lastOrderDays) custMap232[name].lastOrderDays = days;
          } catch { /* skip */ }
          custMap232[name].rev += o.totalPrice || 0;
        }
        const riskList = Object.entries(custMap232)
          .filter(([, d]) => d.orders >= 2)
          .map(([name, d]) => {
            // Risk = cancel rate * 40 + recency score * 30 + low volume * 30
            const cancelRate = d.orders > 0 ? (d.cancelled / d.orders) * 100 : 0;
            const recencyScore = d.lastOrderDays > 90 ? 30 : d.lastOrderDays > 45 ? 20 : d.lastOrderDays > 30 ? 10 : 0;
            const riskScore = Math.min(100, Math.round(cancelRate * 0.4 + recencyScore));
            return { name, riskScore, cancelRate: Math.round(cancelRate), lastOrderDays: d.lastOrderDays, rev: d.rev };
          })
          .sort((a, b) => b.riskScore - a.riskScore)
          .slice(0, 6);
        if (riskList.length === 0) return null;
        const highRisk = riskList.filter(c => c.riskScore >= 50).length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🚨 Müşteri Risk Skoru' : '🚨 Customer Risk Score'}</h3>
              {highRisk > 0 && (
                <span className="text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                  {highRisk} {currentLanguage === 'tr' ? 'yüksek riskli' : 'high risk'}
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {riskList.map(c => (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{c.lastOrderDays}d {currentLanguage === 'tr' ? 'önce' : 'ago'}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${c.riskScore >= 50 ? 'bg-red-100 text-red-700' : c.riskScore >= 25 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {c.riskScore}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.riskScore >= 50 ? 'bg-red-400' : c.riskScore >= 25 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${Math.max(4, c.riskScore)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Risk skoru: iptal oranı + hareketsizlik + düşük hacim (0-100)' : 'Risk score: cancel rate + recency + low volume (0-100 scale)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 6 && (() => {
        const freqMap: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          freqMap[name] = (freqMap[name] ?? 0) + 1;
        }
        const buckets237 = [
          { label: '1', min: 1, max: 1, count: 0 },
          { label: '2-3', min: 2, max: 3, count: 0 },
          { label: '4-6', min: 4, max: 6, count: 0 },
          { label: '7-12', min: 7, max: 12, count: 0 },
          { label: '13+', min: 13, max: Infinity, count: 0 },
        ];
        for (const freq of Object.values(freqMap)) {
          const b = buckets237.find(b => freq >= b.min && freq <= b.max);
          if (b) b.count++;
        }
        const maxBkt237 = Math.max(...buckets237.map(b => b.count), 1);
        const totalCusts237 = Object.keys(freqMap).length;
        const repeatCusts = Object.values(freqMap).filter(f => f >= 2).length;
        const repeatPct = totalCusts237 > 0 ? Math.round((repeatCusts / totalCusts237) * 100) : 0;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Müşteri Satın Alma Sıklığı' : '📊 Customer Purchase Frequency'}</h3>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">%{repeatPct} {currentLanguage === 'tr' ? 'tekrarlı müşteri' : 'repeat customers'}</span>
            </div>
            <div className="flex items-end gap-3 h-24 mb-3">
              {buckets237.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center" style={{ height: '72px' }}>
                    {b.count > 0 && <span className="text-[9px] font-bold text-gray-500 mb-0.5">{b.count}</span>}
                    <div className="w-full flex items-end mt-auto" style={{ height: '56px' }}>
                      <div className="w-full bg-indigo-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBkt237) * 56))}px` }} />
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none">{b.label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: currentLanguage === 'tr' ? 'Toplam Müşteri' : 'Total Customers', value: totalCusts237, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? 'Tekrarlı Alım' : 'Repeat Buyers', value: repeatCusts, color: 'text-emerald-600' },
                { label: currentLanguage === 'tr' ? 'Tek Alım' : 'One-time', value: totalCusts237 - repeatCusts, color: 'text-amber-600' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-2">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[9px] text-gray-400">{k.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now240 = new Date();
        // Rolling 6-month window: what % of customers re-ordered within 90 days?
        const months240 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now240.getFullYear(), now240.getMonth() - (5 - i), 1);
          const label = d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const monthOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
            } catch { return false; }
          });
          const uniqueCusts = new Set(monthOrders.map(o => o.customerName || '—')).size;
          const repeaters = monthOrders.filter(o => {
            const name = o.customerName || '—';
            // Count if this customer also had an order in previous months
            const prevOrder = orders.find(po => {
              if (po === o || po.status === 'Cancelled') return false;
              try {
                const pod = (po.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(po.createdAt as string);
                const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                return po.customerName === name && pod < od;
              } catch { return false; }
            });
            return !!prevOrder;
          });
          const repeatPct240 = uniqueCusts > 0 ? Math.round((new Set(repeaters.map(o => o.customerName || '—')).size / uniqueCusts) * 100) : 0;
          return { label, repeatPct: repeatPct240, uniqueCusts };
        });
        const hasData = months240.some(m => m.uniqueCusts > 0);
        if (!hasData) return null;
        const maxPct = Math.max(...months240.map(m => m.repeatPct), 1);
        const latestRepeat = months240[months240.length - 1].repeatPct;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔁 Tekrar Sipariş Oranı (6 Ay)' : '🔁 Order Repeat Rate (6 Months)'}</h3>
              <span className={`text-xl font-black ${latestRepeat >= 50 ? 'text-emerald-600' : latestRepeat >= 30 ? 'text-amber-500' : 'text-red-500'}`}>%{latestRepeat}</span>
            </div>
            <div className="flex items-end gap-3 h-24 mb-2">
              {months240.map((m, i) => {
                const isLatest = i === months240.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: '68px' }}>
                      {m.repeatPct > 0 && <span className="text-[8px] font-bold text-gray-500 mb-0.5">%{m.repeatPct}</span>}
                      <div className="w-full flex items-end mt-auto" style={{ height: '52px' }}>
                        <div className={`w-full rounded-t-md ${isLatest ? 'bg-indigo-500' : 'bg-indigo-200'}`} style={{ height: `${Math.max(4, Math.round((m.repeatPct / maxPct) * 52))}px` }} />
                      </div>
                    </div>
                    <span className={`text-[9px] leading-none ${isLatest ? 'font-bold text-indigo-600' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Benchmark: %40+ sağlıklı tekrar müşteri oranı (B2B)' : 'Benchmark: 40%+ healthy repeat customer rate (B2B)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 3 && quotations.length >= 2 && (() => {
        const now242 = new Date();
        const monthStart242 = new Date(now242.getFullYear(), now242.getMonth(), 1);
        const monthRev = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart242;
          } catch { return false; }
        }).reduce((s, o) => s + (o.totalPrice || 0), 0);
        // Open quotations = pipeline value
        const openQuotes = quotations.filter(q => {
          const m = q as unknown as Record<string,unknown>;
          const status = (m.status as string) || '';
          return status !== 'Converted to Order' && status !== 'rejected' && status !== 'expired';
        });
        const pipelineVal = openQuotes.reduce((s, q) => {
          const m = q as unknown as Record<string,unknown>;
          return s + ((m.totalAmount as number) || (m.total as number) || 0);
        }, 0);
        const conversionRate = openQuotes.length > 0 ? Math.round((openQuotes.length / Math.max(quotations.length, 1)) * 100) : 0;
        if (pipelineVal === 0 && monthRev === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🎯 Hedef Gerçekleşme vs Boru Hattı' : '🎯 Quota Attainment vs Pipeline'}</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Bu Ay Gerçekleşen' : 'This Month Closed'}</p>
                <p className="text-3xl font-black text-emerald-700">{fmtAna(monthRev,'K',0)}</p>
                <p className="text-[10px] text-emerald-600 mt-1">{currentLanguage === 'tr' ? 'Kapanmış siparişler' : 'Closed orders'}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-1">{currentLanguage === 'tr' ? 'Açık Teklif Pipeline' : 'Open Quote Pipeline'}</p>
                <p className="text-3xl font-black text-blue-700">{fmtAna(pipelineVal,'K',0)}</p>
                <p className="text-[10px] text-blue-600 mt-1">{openQuotes.length} {currentLanguage === 'tr' ? 'açık teklif' : 'open quotes'}</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{currentLanguage === 'tr' ? 'Toplam teklif sayısı' : 'Total quotes'}</span>
                <span className="font-bold text-gray-700">{quotations.length}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{currentLanguage === 'tr' ? 'Açık teklif oranı' : 'Open quote rate'}</span>
                <span className="font-bold text-blue-600">%{conversionRate}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{currentLanguage === 'tr' ? 'Pipeline / Gerçekleşen Oranı' : 'Pipeline / Closed Ratio'}</span>
                <span className="font-bold text-gray-700">{monthRev > 0 ? (pipelineVal / monthRev).toFixed(1) : '—'}×</span>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Customers who bought from category A but never from category B
        const cats244 = [...new Set(inventory.map(i => i.category).filter(Boolean))].slice(0, 4) as string[];
        if (cats244.length < 2) return null;
        const custCats: Record<string, Set<string>> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          if (!custCats[name]) custCats[name] = new Set();
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            if (inv?.category) custCats[name].add(inv.category);
          }
        }
        // For each pair of categories, find customers who bought A but not B
        const opportunities: { catA: string; catB: string; count: number }[] = [];
        for (let a = 0; a < cats244.length; a++) {
          for (let b = 0; b < cats244.length; b++) {
            if (a === b) continue;
            const count = Object.values(custCats).filter(s => s.has(cats244[a]) && !s.has(cats244[b])).length;
            if (count >= 2) opportunities.push({ catA: cats244[a], catB: cats244[b], count });
          }
        }
        const top6 = opportunities.sort((a, b) => b.count - a.count).slice(0, 6);
        if (top6.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🔀 Çapraz Satış Fırsatı Matrisi' : '🔀 Cross-Sell Opportunity Matrix'}</h3>
            <div className="space-y-2">
              {top6.map((op, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5 bg-blue-50 rounded-xl">
                  <span className="text-xs font-bold text-blue-800 truncate">{op.catA}</span>
                  <span className="text-blue-400 text-xs shrink-0">→</span>
                  <span className="text-xs font-bold text-emerald-700 truncate">{op.catB}</span>
                  <span className="text-[10px] text-gray-500 shrink-0 ml-auto">{op.count} {currentLanguage === 'tr' ? 'müşteri' : 'customers'}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'A kategorisini satın alan ama B kategorisini henüz almayan müşteriler' : 'Customers who bought category A but not yet category B'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const now247 = new Date();
        const openQuotes247 = quotations.filter(q => {
          const m = q as unknown as Record<string,unknown>;
          const status = (m.status as string) || '';
          return status !== 'Converted to Order' && status !== 'rejected' && status !== 'expired';
        });
        if (openQuotes247.length === 0) return null;
        const ageBuckets247 = [
          { label: currentLanguage === 'tr' ? '0-7 Gün' : '0-7 Days', min: 0, max: 7, count: 0, value: 0 },
          { label: currentLanguage === 'tr' ? '8-14 Gün' : '8-14 Days', min: 8, max: 14, count: 0, value: 0 },
          { label: currentLanguage === 'tr' ? '15-30 Gün' : '15-30 Days', min: 15, max: 30, count: 0, value: 0 },
          { label: currentLanguage === 'tr' ? '30+ Gün' : '30+ Days', min: 31, max: Infinity, count: 0, value: 0 },
        ];
        for (const q of openQuotes247) {
          const m = q as unknown as Record<string,unknown>;
          const val = (m.totalAmount as number) || (m.total as number) || 0;
          try {
            const created = (q.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(q.createdAt as string);
            const age = Math.round((now247.getTime() - created.getTime()) / 86400000);
            const b = ageBuckets247.find(b => age >= b.min && age <= b.max);
            if (b) { b.count++; b.value += val; }
          } catch { /* skip */ }
        }
        const staleQuotes = ageBuckets247.slice(2).reduce((s, b) => s + b.value, 0);
        const totalQVal = ageBuckets247.reduce((s, b) => s + b.value, 0);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏰ Teklif Yaşlandırma Analizi' : '⏰ Quotation Aging Analysis'}</h3>
              {staleQuotes > 0 && (
                <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                  {fmtAna(staleQuotes,'K',0)} {currentLanguage === 'tr' ? 'eski teklif' : 'stale quotes'}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {ageBuckets247.map(b => (
                <div key={b.label} className={`rounded-xl p-3 ${b.min >= 15 && b.count > 0 ? 'bg-amber-50 border border-amber-100' : 'bg-gray-50'}`}>
                  <p className={`text-xl font-bold ${b.min >= 15 && b.count > 0 ? 'text-amber-600' : 'text-gray-700'}`}>{b.count}</p>
                  <p className="text-[10px] text-gray-600 font-medium">{b.label}</p>
                  {b.value > 0 && <p className="text-[9px] text-gray-400">{fmtAna(b.value,'K',0)}</p>}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? `${openQuotes247.length} açık teklif · Toplam: ₺${(totalQVal/1000).toFixed(0)}K` : `${openQuotes247.length} open quotes · Total: ₺${(totalQVal/1000).toFixed(0)}K`}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        // For each customer, find gap between 1st and 2nd order
        const custFirstTwo: Record<string, number[]> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const name = o.customerName || '—';
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (!custFirstTwo[name]) custFirstTwo[name] = [];
            custFirstTwo[name].push(od.getTime());
          } catch { /* skip */ }
        }
        const reorderDays: number[] = [];
        for (const times of Object.values(custFirstTwo)) {
          if (times.length < 2) continue;
          times.sort((a, b) => a - b);
          const gap = Math.round((times[1] - times[0]) / 86400000);
          if (gap > 0 && gap < 365) reorderDays.push(gap);
        }
        if (reorderDays.length < 3) return null;
        reorderDays.sort((a, b) => a - b);
        const avgDays252 = Math.round(reorderDays.reduce((s, d) => s + d, 0) / reorderDays.length);
        const medianDays252 = reorderDays[Math.floor(reorderDays.length / 2)];
        const fast252 = reorderDays.filter(d => d <= 30).length;
        const slow252 = reorderDays.filter(d => d > 90).length;
        const buckets252 = [
          { label: '≤7d', max: 7, count: 0 },
          { label: '8-30d', max: 30, count: 0 },
          { label: '31-60d', max: 60, count: 0 },
          { label: '61-90d', max: 90, count: 0 },
          { label: '90d+', max: Infinity, count: 0 },
        ];
        for (const d of reorderDays) {
          const b = buckets252.find(b => d <= b.max);
          if (b) b.count++;
        }
        const maxBkt252 = Math.max(...buckets252.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔄 İlk Yeniden Sipariş Süresi' : '🔄 Days to First Reorder'}</h3>
              <span className="text-xl font-black text-blue-600">{avgDays252}d {currentLanguage === 'tr' ? 'ort.' : 'avg'}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Ortalama' : 'Average', value: `${avgDays252}d`, color: 'text-blue-600' },
                { label: currentLanguage === 'tr' ? 'Medyan' : 'Median', value: `${medianDays252}d`, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? '≤30 gün tekrar' : '≤30d reorder', value: `${fast252}`, color: 'text-emerald-600' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2 h-14">
              {buckets252.map(b => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end" style={{ height: '40px' }}>
                    <div className="w-full bg-blue-300 rounded-t-md" style={{ height: `${Math.max(4, Math.round((b.count / maxBkt252) * 40))}px` }} />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none">{b.label}</span>
                </div>
              ))}
            </div>
            {slow252 > 0 && <p className="text-[10px] text-amber-600 mt-2 font-medium">⚠ {slow252} {currentLanguage === 'tr' ? 'müşteri 90+ günde tekrar sipariş verdi' : 'customers took 90+ days to reorder'}</p>}
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 5 && (() => {
        // How long quotes sit at each status before moving
        const now255 = new Date();
        const stageGroups: Record<string, number[]> = { draft: [], sent: [], negotiation: [], pending: [] };
        for (const q of quotations) {
          const m = q as unknown as Record<string,unknown>;
          const status = ((m.status as string) || '').toLowerCase();
          try {
            const created = (q.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(q.createdAt as string);
            const age = Math.round((now255.getTime() - created.getTime()) / 86400000);
            if (age < 0 || age > 365) continue;
            if (status === 'draft' || status === 'taslak') stageGroups.draft.push(age);
            else if (status === 'sent' || status === 'gönderildi') stageGroups.sent.push(age);
            else if (status === 'negotiation' || status === 'müzakere') stageGroups.negotiation.push(age);
            else if (status === 'pending' || status === 'beklemede') stageGroups.pending.push(age);
          } catch { /* skip */ }
        }
        const stages255 = [
          { key: 'draft', label: currentLanguage === 'tr' ? 'Taslak' : 'Draft', color: 'bg-gray-400' },
          { key: 'sent', label: currentLanguage === 'tr' ? 'Gönderildi' : 'Sent', color: 'bg-blue-400' },
          { key: 'negotiation', label: currentLanguage === 'tr' ? 'Müzakere' : 'Negotiation', color: 'bg-amber-400' },
          { key: 'pending', label: currentLanguage === 'tr' ? 'Beklemede' : 'Pending', color: 'bg-purple-400' },
        ].map(s => ({
          ...s,
          avg: stageGroups[s.key].length > 0 ? Math.round(stageGroups[s.key].reduce((a, b) => a + b, 0) / stageGroups[s.key].length) : 0,
          count: stageGroups[s.key].length,
        })).filter(s => s.count > 0);
        if (stages255.length === 0) {
          // Fallback: just show quote status distribution
          const statusDist: Record<string, number> = {};
          for (const q of quotations) {
            const m = q as unknown as Record<string,unknown>;
            const st = (m.status as string) || (currentLanguage === 'tr' ? 'Bilinmiyor' : 'Unknown');
            statusDist[st] = (statusDist[st] ?? 0) + 1;
          }
          const items = Object.entries(statusDist).sort(([,a],[,b]) => b - a).slice(0, 5);
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📋 Teklif Durum Dağılımı' : '📋 Quote Status Distribution'}</h3>
              <div className="space-y-2">
                {items.map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 capitalize">{status}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((count / quotations.length) * 100)}%` }} />
                      </div>
                      <span className="font-bold text-gray-700 w-6 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        const maxAvg255 = Math.max(...stages255.map(s => s.avg), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '⚡ Pipeline Aşama Hızı' : '⚡ Pipeline Stage Velocity'}</h3>
            <div className="space-y-3">
              {stages255.map(s => (
                <div key={s.key}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${s.color}`} />
                      <span className="text-xs font-medium text-gray-700">{s.label}</span>
                      <span className="text-[10px] text-gray-400">({s.count})</span>
                    </div>
                    <span className={`text-sm font-bold ${s.avg > 14 ? 'text-red-500' : s.avg > 7 ? 'text-amber-500' : 'text-emerald-600'}`}>{s.avg}d {currentLanguage === 'tr' ? 'ort.' : 'avg'}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${s.color}`} style={{ width: `${Math.max(4, Math.round((s.avg / maxAvg255) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Her aşamada tekliflerin ortalama bekleme süresi' : 'Avg time quotes spend at each pipeline stage'}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now258 = new Date();
        const monthStart258 = new Date(now258.getFullYear(), now258.getMonth(), 1);
        const mOrders258 = orders.filter(o => {
          if (o.status === 'Cancelled') return false;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= monthStart258;
          } catch { return false; }
        });
        if (mOrders258.length < 3) return null;
        const custRevMap258: Record<string, number> = {};
        for (const o of mOrders258) {
          const name = o.customerName || '—';
          custRevMap258[name] = (custRevMap258[name] ?? 0) + (o.totalPrice || 0);
        }
        const sorted258 = Object.entries(custRevMap258).sort(([,a],[,b]) => b - a).slice(0, 8);
        const total258 = sorted258.reduce((s,[,v]) => s + v, 0);
        let cumPct258 = 0;
        const withCum = sorted258.map(([name, rev]) => {
          const pct = total258 > 0 ? Math.round((rev / total258) * 100) : 0;
          cumPct258 += pct;
          return { name, rev, pct, cumPct: cumPct258 };
        });
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🥧 Bu Ay Müşteri Cüzdan Payı' : '🥧 This Month Customer Wallet Share'}</h3>
              <span className="text-[10px] text-gray-400">{withCum.length} {currentLanguage === 'tr' ? 'müşteri' : 'customers'} · {fmtAna(total258,'K',0)}</span>
            </div>
            <div className="space-y-2">
              {withCum.map((c, i) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-purple-600 font-bold">Σ%{c.cumPct}</span>
                      <span className="text-xs font-bold text-gray-700">%{c.pct}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${i === 0 ? 'bg-purple-500' : i === 1 ? 'bg-purple-400' : i <= 3 ? 'bg-purple-300' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, c.pct)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const firstOrderByCustomer: Record<string, Date> = {};
        [...orders].sort((a,b) => {
          const da = (a.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(a.createdAt as string);
          const db = (b.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(b.createdAt as string);
          return da.getTime() - db.getTime();
        }).forEach(o => {
          if (!firstOrderByCustomer[o.customerName]) {
            firstOrderByCustomer[o.customerName] = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          }
        });
        const monthCounts: Record<string, number> = {};
        Object.values(firstOrderByCustomer).forEach(d => {
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthCounts[key] = (monthCounts[key] || 0) + 1;
        });
        const months = Object.keys(monthCounts).sort().slice(-12);
        if (months.length < 2) return null;
        const maxC = Math.max(...months.map(m => monthCounts[m]));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer Acquisition by Month</h3>
            <p className="text-xs text-gray-500 mb-4">New customers (first order) per month — last 12 months</p>
            <div className="flex items-end gap-1 h-28">
              {months.map(m => (
                <div key={m} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600 font-bold">{monthCounts[m]}</span>
                  <div className="w-full rounded-t" style={{ height: `${maxC > 0 ? (monthCounts[m]/maxC*80) : 4}px`, background: '#10b981', minHeight: '4px' }} />
                  <span className="text-[8px] text-gray-400 rotate-45 origin-left whitespace-nowrap">{m.slice(5)}/{m.slice(2,4)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">Total new customers tracked: {Object.keys(firstOrderByCustomer).length}</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const tiers: Record<string, {revenue: number; orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const tier = o.customerType || 'Unknown';
          if (!tiers[tier]) tiers[tier] = { revenue: 0, orders: 0, customers: new Set() };
          tiers[tier].revenue += o.totalPrice;
          tiers[tier].orders++;
          tiers[tier].customers.add(o.customerName);
        });
        const tierData = Object.entries(tiers).map(([tier, d]) => ({
          tier,
          revenue: d.revenue,
          orders: d.orders,
          customers: d.customers.size,
          avgOrder: d.orders > 0 ? d.revenue / d.orders : 0,
          revenuePerCustomer: d.customers.size > 0 ? d.revenue / d.customers.size : 0,
        })).sort((a,b) => b.revenue - a.revenue);
        if (tierData.length === 0) return null;
        const totalRevenue = tierData.reduce((s,t) => s+t.revenue, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Customer Tier Revenue Matrix</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100">
                    <th className="text-left pb-2">Tier</th>
                    <th className="text-right pb-2">Revenue</th>
                    <th className="text-right pb-2">Share</th>
                    <th className="text-right pb-2">Orders</th>
                    <th className="text-right pb-2">Customers</th>
                    <th className="text-right pb-2">Avg Order</th>
                    <th className="text-right pb-2">Rev/Customer</th>
                  </tr>
                </thead>
                <tbody>
                  {tierData.map((t,i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-gray-800">{t.tier}</td>
                      <td className="py-2 text-right">{fmtAna(t.revenue,'full',0)}</td>
                      <td className="py-2 text-right font-bold" style={{ color: i===0?'#10b981':'#6b7280' }}>{totalRevenue > 0 ? ((t.revenue/totalRevenue)*100).toFixed(1) : 0}%</td>
                      <td className="py-2 text-right">{t.orders}</td>
                      <td className="py-2 text-right">{t.customers}</td>
                      <td className="py-2 text-right">{fmtAna(t.avgOrder,'full',0)}</td>
                      <td className="py-2 text-right">{fmtAna(t.revenuePerCustomer,'full',0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const repData: Record<string, {revenue: number; cost: number; count: number}> = {};
        orders.forEach(o => {
          const rep = (o.assignedTo as string) || 'Unassigned';
          if (!repData[rep]) repData[rep] = { revenue: 0, cost: 0, count: 0 };
          repData[rep].revenue += o.totalPrice;
          repData[rep].count++;
          repData[rep].cost += (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
        });
        const reps = Object.entries(repData)
          .map(([rep, d]) => ({ rep, revenue: d.revenue, cost: d.cost, count: d.count, margin: d.revenue - d.cost, marginPct: d.revenue > 0 ? ((d.revenue - d.cost)/d.revenue*100) : 0 }))
          .sort((a,b) => b.margin - a.margin).slice(0,8);
        if (reps.length === 0) return null;
        const maxMargin = Math.max(...reps.map(r => r.margin));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Gross Margin by Sales Rep</h3>
            <div className="space-y-2">
              {reps.map((r,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{r.rep}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxMargin > 0 ? Math.max(2, r.margin/maxMargin*100) : 2}%`, background: r.marginPct >= 30 ? '#10b981' : r.marginPct >= 15 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{ color: r.marginPct >= 30 ? '#10b981' : r.marginPct >= 15 ? '#f59e0b' : '#ef4444' }}>{r.marginPct.toFixed(0)}%</span>
                  <span className="text-xs text-gray-400 w-20 text-right">{fmtAna(r.margin,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const segments: Record<string, {revenue: number; cost: number; orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const seg = o.customerType || 'Unknown';
          if (!segments[seg]) segments[seg] = { revenue: 0, cost: 0, orders: 0, customers: new Set() };
          segments[seg].revenue += o.totalPrice;
          segments[seg].orders++;
          segments[seg].customers.add(o.customerName);
          segments[seg].cost += (o.lineItems || []).reduce((s, li) => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            return s + (inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0)) * li.quantity;
          }, 0);
        });
        const data = Object.entries(segments).map(([seg, d]) => ({
          seg, revenue: d.revenue, cost: d.cost, orders: d.orders, customers: d.customers.size,
          margin: d.revenue - d.cost,
          marginPct: d.revenue > 0 ? ((d.revenue - d.cost)/d.revenue*100) : 0,
          ltv: d.customers.size > 0 ? d.revenue / d.customers.size : 0,
        })).sort((a,b) => b.margin - a.margin);
        if (data.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Customer Segment Profitability</h3>
            <div className="space-y-4">
              {data.map((d,i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-gray-800">{d.seg}</span>
                    <span className="text-sm font-black" style={{ color: d.marginPct >= 25 ? '#10b981' : d.marginPct >= 10 ? '#f59e0b' : '#ef4444' }}>{d.marginPct.toFixed(1)}% margin</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs text-center">
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.revenue,'K',0)}</div><div className="text-gray-400">Revenue</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.margin,'K',0)}</div><div className="text-gray-400">Margin</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{d.customers}</div><div className="text-gray-400">Customers</div></div>
                    <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-800">{fmtAna(d.ltv,'K',0)}</div><div className="text-gray-400">LTV</div></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const geoRevenue: Record<string, {revenue: number; orders: number}> = {};
        orders.forEach(o => {
          const addr = (o.shippingAddress || '').toLowerCase();
          let region = 'Unknown';
          if (addr.includes('istanbul') || addr.includes('İstanbul')) region = 'İstanbul';
          else if (addr.includes('ankara')) region = 'Ankara';
          else if (addr.includes('izmir') || addr.includes('İzmir')) region = 'İzmir';
          else if (addr.includes('bursa')) region = 'Bursa';
          else if (addr.includes('antalya')) region = 'Antalya';
          else if (addr.includes('adana')) region = 'Adana';
          else if (addr.match(/\b(tr|turkey|türkiye)\b/)) region = 'Other TR';
          else if (addr.length > 3) region = 'Other';
          if (!geoRevenue[region]) geoRevenue[region] = { revenue: 0, orders: 0 };
          geoRevenue[region].revenue += o.totalPrice;
          geoRevenue[region].orders++;
        });
        const regions = Object.entries(geoRevenue)
          .map(([region, d]) => ({ region, ...d }))
          .sort((a,b) => b.revenue - a.revenue).slice(0,7);
        if (regions.length === 0 || (regions.length === 1 && regions[0].region === 'Unknown')) return null;
        const totalRev = regions.reduce((s,r)=>s+r.revenue,0);
        const maxRev = Math.max(...regions.map(r=>r.revenue));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Revenue Concentration by Region</h3>
            <div className="space-y-2">
              {regions.map((r,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-24 font-medium">{r.region}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${maxRev>0?(r.revenue/maxRev*100):0}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right">{r.orders} ord</span>
                  <span className="text-xs font-bold text-indigo-700 w-10 text-right">{totalRev>0?((r.revenue/totalRev)*100).toFixed(0):0}%</span>
                  <span className="text-xs text-gray-600 w-20 text-right">{fmtAna(r.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const custByMonth: Record<string, Set<string>> = {};
        months.forEach(m => { custByMonth[m.key] = new Set(); });
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (custByMonth[key]) custByMonth[key].add(o.customerName);
        });
        const data = months.map((m, i) => {
          const current = custByMonth[m.key];
          const prev = i > 0 ? custByMonth[months[i-1].key] : new Set<string>();
          const newCusts = [...current].filter(c => !prev.has(c)).length;
          const lostCusts = i > 0 ? [...prev].filter(c => !current.has(c)).length : 0;
          return { label: m.label, new: newCusts, lost: lostCusts, net: newCusts - lostCusts };
        });
        const hasData = data.some(d => d.new > 0 || d.lost > 0);
        if (!hasData) return null;
        const maxVal = Math.max(...data.map(d => Math.max(d.new, d.lost)), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer Gain/Loss Balance</h3>
            <p className="text-xs text-gray-500 mb-4">New vs churned customers per month (MoM)</p>
            <div className="flex items-center justify-center gap-1 mb-2">
              <span className="w-3 h-3 rounded-sm bg-green-400 inline-block"></span><span className="text-xs text-gray-500 mr-4">New</span>
              <span className="w-3 h-3 rounded-sm bg-red-400 inline-block"></span><span className="text-xs text-gray-500">Lost</span>
            </div>
            <div className="flex items-end justify-around gap-2 h-28">
              {data.map((d,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: '80px' }}>
                    <div className="w-1/2 rounded-t bg-green-400" style={{ height: `${maxVal>0?(d.new/maxVal*80):2}px`, minHeight: d.new>0?'4px':'0' }} title={`New: ${d.new}`} />
                    <div className="w-1/2 rounded-t bg-red-400" style={{ height: `${maxVal>0?(d.lost/maxVal*80):2}px`, minHeight: d.lost>0?'4px':'0' }} title={`Lost: ${d.lost}`} />
                  </div>
                  <span className="text-[9px] text-gray-500">{d.label}</span>
                  <span className="text-[9px] font-bold" style={{ color: d.net >= 0 ? '#10b981' : '#ef4444' }}>{d.net >= 0 ? '+' : ''}{d.net}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 5 && orders.length >= 5 && (() => {
        const converted = quotations.filter(q => q.status === 'Converted to Order');
        if (converted.length < 3) return null;
        const timings: number[] = [];
        converted.forEach(q => {
          const qDate = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!qDate) return;
          const matchOrder = orders.find(o => o.leadId === q.leadId || o.customerName === q.customerName);
          if (!matchOrder) return;
          const oDate = (matchOrder.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(matchOrder.createdAt as string);
          const days = Math.floor((oDate.getTime() - qDate.getTime()) / 86400000);
          if (days >= 0 && days <= 365) timings.push(days);
        });
        if (timings.length < 2) return null;
        const avg = timings.reduce((s,t)=>s+t,0)/timings.length;
        const median = [...timings].sort((a,b)=>a-b)[Math.floor(timings.length/2)];
        const under7 = timings.filter(t=>t<=7).length;
        const under30 = timings.filter(t=>t<=30).length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Quote-to-Cash Timeline</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-blue-700">{avg.toFixed(1)}d</div>
                <div className="text-xs text-gray-500">Average Close Time</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-green-700">{median}d</div>
                <div className="text-xs text-gray-500">Median Close Time</div>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Closed within 7 days</span>
                <span className="font-bold text-green-600">{under7} / {timings.length} ({timings.length>0?((under7/timings.length)*100).toFixed(0):0}%)</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Closed within 30 days</span>
                <span className="font-bold text-blue-600">{under30} / {timings.length} ({timings.length>0?((under30/timings.length)*100).toFixed(0):0}%)</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Conversion rate</span>
                <span className="font-bold text-purple-600">{quotations.length>0?((converted.length/quotations.length)*100).toFixed(1):0}% ({converted.length}/{quotations.length})</span>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custOrders: Record<string, {count: number; revenue: number; first: Date; last: Date}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custOrders[o.customerName]) custOrders[o.customerName] = { count: 0, revenue: 0, first: d, last: d };
          custOrders[o.customerName].count++;
          custOrders[o.customerName].revenue += o.totalPrice;
          if (d < custOrders[o.customerName].first) custOrders[o.customerName].first = d;
          if (d > custOrders[o.customerName].last) custOrders[o.customerName].last = d;
        });
        const now = new Date();
        const custData = Object.entries(custOrders).map(([name, d]) => {
          const tenureDays = (d.last.getTime() - d.first.getTime()) / 86400000;
          const daysSinceLast = (now.getTime() - d.last.getTime()) / 86400000;
          const loyaltyScore = Math.min(100, Math.round(
            (d.count * 15) +
            (Math.min(tenureDays, 365) / 365 * 40) +
            (Math.max(0, 1 - daysSinceLast/90) * 30) +
            (Math.min(d.revenue, 100000) / 100000 * 15)
          ));
          return { name, count: d.count, revenue: d.revenue, loyaltyScore, daysSinceLast: Math.floor(daysSinceLast) };
        }).sort((a,b)=>b.loyaltyScore-a.loyaltyScore).slice(0,8);
        if (custData.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer Loyalty Index</h3>
            <p className="text-xs text-gray-500 mb-3">Composite score: order freq, tenure, recency, revenue (0-100)</p>
            <div className="space-y-2">
              {custData.map((c,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                  <span className="text-xs text-gray-700 truncate w-28 font-medium">{c.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.loyaltyScore}%`, background: c.loyaltyScore >= 70 ? '#10b981' : c.loyaltyScore >= 40 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="text-xs font-black w-8 text-right" style={{ color: c.loyaltyScore >= 70 ? '#10b981' : c.loyaltyScore >= 40 ? '#f59e0b' : '#ef4444' }}>{c.loyaltyScore}</span>
                  <span className="text-xs text-gray-400 w-12 text-right">{c.count} ord</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 15 && (() => {
        const cohortMap: Record<string, {customers: Set<string>; months: Record<string, number>}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const cohortKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!cohortMap[cohortKey]) cohortMap[cohortKey] = { customers: new Set(), months: {} };
        });
        // Find each customer's first order month
        const custFirstMonth: Record<string, string> = {};
        [...orders].sort((a,b) => {
          const da = (a.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(a.createdAt as string);
          const db = (b.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(b.createdAt as string);
          return da.getTime()-db.getTime();
        }).forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!custFirstMonth[o.customerName]) custFirstMonth[o.customerName] = key;
        });
        orders.forEach(o => {
          const cohort = custFirstMonth[o.customerName];
          if (!cohort || !cohortMap[cohort]) return;
          cohortMap[cohort].customers.add(o.customerName);
        });
        const cohorts = Object.keys(cohortMap).sort().slice(-5);
        if (cohorts.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Cohort Customer Count (Last 5 Cohorts)</h3>
            <div className="space-y-2">
              {cohorts.map((cohort,i) => {
                const cData = cohortMap[cohort];
                const size = cData.customers.size;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-16 font-medium">{cohort.slice(5)}/{cohort.slice(2,4)}</span>
                    <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${size > 0 ? Math.min(100, size * 10) : 2}%` }} />
                    </div>
                    <span className="text-xs font-bold text-violet-700 w-20 text-right">{size} customers</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">Cohort = month of customer's first order</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custFreq: Record<string, {count: number; revenue: number; lastDate: Date}> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custFreq[o.customerName]) custFreq[o.customerName] = { count: 0, revenue: 0, lastDate: d };
          custFreq[o.customerName].count++;
          custFreq[o.customerName].revenue += o.totalPrice;
          if (d > custFreq[o.customerName].lastDate) custFreq[o.customerName].lastDate = d;
        });
        const top = Object.entries(custFreq)
          .map(([name, d]) => ({ name, ...d }))
          .sort((a,b)=>b.count-a.count).slice(0,8);
        if (top.length === 0) return null;
        const maxCount = top[0].count;
        const now = new Date();
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Top Customers by Order Frequency</h3>
            <div className="space-y-2">
              {top.map((c,i) => {
                const daysSince = Math.floor((now.getTime() - c.lastDate.getTime())/86400000);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                    <span className="text-xs text-gray-700 truncate w-28 font-medium">{c.name}</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-rose-500" style={{ width: `${maxCount>0?(c.count/maxCount*100):0}%` }} />
                    </div>
                    <span className="text-xs font-bold text-rose-700 w-12 text-right">{c.count}x</span>
                    <span className="text-xs text-gray-400 w-12 text-right">{daysSince}d ago</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const now = new Date();
        const staleQuotes = quotations.filter(q => {
          if (q.status === 'Converted to Order' || q.status === 'approved') return false;
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!d) return false;
          const age = (now.getTime() - d.getTime()) / 86400000;
          return age >= 7;
        }).map(q => {
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string);
          const age = Math.floor((now.getTime() - d.getTime()) / 86400000);
          const value = q.totalAmount || (q.items||q.lineItems||[]).reduce((s, i) => s + i.price * i.quantity, 0);
          return { customer: q.customerName, age, value, status: q.status };
        }).sort((a,b)=>b.value-a.value).slice(0,8);
        if (staleQuotes.length === 0) return null;
        const totalOpportunity = staleQuotes.reduce((s,q)=>s+q.value,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Stale Quote Recovery Opportunities</h3>
            <p className="text-xs text-gray-500 mb-3">Unconverted quotes (7+ days old) — {fmtAna(totalOpportunity,'full',0)} total opportunity</p>
            <div className="space-y-2">
              {staleQuotes.map((q,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: q.age >= 30 ? '#fef2f2' : q.age >= 14 ? '#fffbeb' : '#f8fafc' }}>
                  <span className="font-medium text-gray-800 truncate w-32">{q.customer}</span>
                  <span className="text-gray-400 capitalize">{q.status}</span>
                  <span style={{ color: q.age >= 30 ? '#ef4444' : q.age >= 14 ? '#f59e0b' : '#6b7280' }} className="font-bold">{q.age}d old</span>
                  <span className="font-bold text-gray-800">{fmtAna(q.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custOrders: Record<string, {count: number; recent: boolean}> = {};
        const now = new Date();
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const isRecent = (now.getTime() - d.getTime()) / 86400000 <= 90;
          if (!custOrders[o.customerName]) custOrders[o.customerName] = { count: 0, recent: false };
          custOrders[o.customerName].count++;
          if (isRecent) custOrders[o.customerName].recent = true;
        });
        const total = Object.keys(custOrders).length;
        if (total < 5) return null;
        const promoters = Object.values(custOrders).filter(c => c.count >= 3 && c.recent).length;
        const detractors = Object.values(custOrders).filter(c => c.count === 1 && !c.recent).length;
        const passives = total - promoters - detractors;
        const npsProxy = Math.round(((promoters - detractors) / total) * 100);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">NPS Proxy Score</h3>
            <p className="text-xs text-gray-500 mb-4">Based on repeat purchase behaviour — not survey data</p>
            <div className="flex items-center justify-center mb-4">
              <div className="text-5xl font-black" style={{ color: npsProxy >= 50 ? '#10b981' : npsProxy >= 0 ? '#f59e0b' : '#ef4444' }}>{npsProxy >= 0 ? '+' : ''}{npsProxy}</div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div className="bg-green-50 rounded-xl p-3">
                <div className="text-lg font-black text-green-700">{promoters}</div>
                <div className="text-gray-500">Promoters</div>
                <div className="text-[10px] text-gray-400">3+ orders, active</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-lg font-black text-gray-600">{passives}</div>
                <div className="text-gray-500">Passives</div>
                <div className="text-[10px] text-gray-400">occasional buyers</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-lg font-black text-red-600">{detractors}</div>
                <div className="text-gray-500">Detractors</div>
                <div className="text-[10px] text-gray-400">1 order, gone quiet</div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custTotal: Record<string, number> = {};
        orders.forEach(o => { custTotal[o.customerName] = (custTotal[o.customerName]||0) + o.totalPrice; });
        const buckets = [
          { label: '₺0–10k', min: 0, max: 10000, color: '#94a3b8' },
          { label: '₺10k–50k', min: 10000, max: 50000, color: '#3b82f6' },
          { label: '₺50k–200k', min: 50000, max: 200000, color: '#10b981' },
          { label: '₺200k+', min: 200000, max: Infinity, color: '#f59e0b' },
        ];
        const bucketData = buckets.map(b => {
          const custs = Object.entries(custTotal).filter(([,v]) => v >= b.min && v < b.max);
          return { ...b, count: custs.length, revenue: custs.reduce((s,[,v])=>s+v,0) };
        });
        const totalRev = bucketData.reduce((s,b)=>s+b.revenue,0);
        const totalCusts = bucketData.reduce((s,b)=>s+b.count,0);
        if (totalCusts === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Customer Spend Bucket Segmentation</h3>
            <div className="space-y-3">
              {bucketData.map((b,i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{b.label}</span>
                    <span className="text-gray-500">{b.count} customers · {totalRev>0?((b.revenue/totalRev)*100).toFixed(0):0}% revenue</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${totalCusts>0?(b.count/totalCusts*100):0}%`, background: b.color }} title="Customer %" />
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full opacity-70" style={{ width: `${totalRev>0?(b.revenue/totalRev*100):0}%`, background: b.color }} title="Revenue %" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-2 text-[10px] text-gray-400">
              <span>Left bar = customer share</span><span>Right bar = revenue share</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && quotations.length >= 3 && (() => {
        const now = new Date();
        const responseGroups = [
          { label: 'Same day', days: 0, count: 0, color: '#10b981' },
          { label: '1-3 days', days: 3, count: 0, color: '#3b82f6' },
          { label: '4-7 days', days: 7, count: 0, color: '#f59e0b' },
          { label: '8-14 days', days: 14, count: 0, color: '#f97316' },
          { label: '15+ days', days: 999, count: 0, color: '#ef4444' },
        ];
        quotations.forEach(q => {
          const d = (q.createdAt as {toDate?:()=>Date}).toDate?.() ?? (q.createdAt ? new Date(q.createdAt as string) : null);
          if (!d) return;
          const age = (now.getTime() - d.getTime()) / 86400000;
          if (age <= 1) responseGroups[0].count++;
          else if (age <= 3) responseGroups[1].count++;
          else if (age <= 7) responseGroups[2].count++;
          else if (age <= 14) responseGroups[3].count++;
          else responseGroups[4].count++;
        });
        const total = quotations.length;
        if (total === 0) return null;
        const maxCount = Math.max(...responseGroups.map(g=>g.count));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quotation Age Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">{total} quotations — age from creation date</p>
            <div className="space-y-2">
              {responseGroups.map((g,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20">{g.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${maxCount>0?(g.count/maxCount*100):0}%`, background: g.color }} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right" style={{ color: g.color }}>{g.count}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{total>0?((g.count/total)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const repMonthly: Record<string, Record<string, number>> = {};
        const now = new Date();
        const months = Array.from({length: 6}, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
          return {key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth()};
        });
        orders.forEach(o => {
          const rep = (o.assignedTo as string) || 'Unassigned';
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const mkey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (!repMonthly[rep]) repMonthly[rep] = {};
          repMonthly[rep][mkey] = (repMonthly[rep][mkey] || 0) + o.totalPrice;
        });
        const reps = Object.entries(repMonthly)
          .map(([rep, mdata]) => ({rep, total: Object.values(mdata).reduce((s, v) => s + v, 0), months: mdata}))
          .sort((a, b) => b.total - a.total).slice(0, 5);
        if (reps.length === 0) return null;
        const allVals = reps.flatMap(r => months.map(m => r.months[m.key] || 0));
        const maxVal = Math.max(...allVals, 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Sales Rep Activity Heatmap — 6 Months</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left pb-2 w-24">Rep</th>
                    {months.map(m => <th key={m.key} className="text-center pb-2 w-10">{m.label}</th>)}
                    <th className="text-right pb-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reps.map((r, i) => (
                    <tr key={i}>
                      <td className="py-1 text-gray-700 font-medium truncate max-w-[6rem]">{r.rep}</td>
                      {months.map(m => {
                        const v = r.months[m.key] || 0;
                        const intensity = maxVal > 0 ? v / maxVal : 0;
                        return (
                          <td key={m.key} className="py-1 px-0.5">
                            <div className="rounded h-6 flex items-center justify-center text-[8px] font-bold" style={{
                              background: v === 0 ? '#f3f4f6' : `rgba(99,102,241,${0.15 + intensity * 0.85})`,
                              color: intensity > 0.5 ? 'white' : '#4b5563'
                            }} title={`₺${v.toLocaleString('tr-TR', {maximumFractionDigits: 0})}`}>
                              {v > 0 ? `${(v / 1000).toFixed(0)}k` : '-'}
                            </div>
                          </td>
                        );
                      })}
                      <td className="py-1 text-right font-bold text-gray-800">{fmtAna(r.total,'K',0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custDates: Record<string, Date[]> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          if (!custDates[o.customerName]) custDates[o.customerName] = [];
          custDates[o.customerName].push(d);
        });
        const gaps: number[] = [];
        Object.values(custDates).forEach(dates => {
          const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
          for (let i = 1; i < sorted.length; i++) {
            const gap = Math.floor((sorted[i].getTime() - sorted[i - 1].getTime()) / 86400000);
            if (gap > 0 && gap <= 365) gaps.push(gap);
          }
        });
        if (gaps.length < 3) return null;
        const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        const buckets = [
          {label: '≤7d', max: 7, color: '#10b981'},
          {label: '8–14d', max: 14, color: '#3b82f6'},
          {label: '15–30d', max: 30, color: '#f59e0b'},
          {label: '31–90d', max: 90, color: '#f97316'},
          {label: '91d+', max: 999, color: '#ef4444'},
        ];
        const bucketCounts = buckets.map((b, i) => ({
          ...b,
          count: gaps.filter(g => g <= b.max && (i === 0 || g > buckets[i - 1].max)).length,
        }));
        const maxCount = Math.max(...bucketCounts.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer Re-Order Gap Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Days between consecutive orders per customer · avg: {avg.toFixed(0)} days</p>
            <div className="flex items-end gap-3 h-20">
              {bucketCounts.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600 font-bold">{b.count}</span>
                  <div className="w-full rounded-t" style={{height: `${maxCount > 0 ? Math.max(4, b.count / maxCount * 60) : 4}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const total322 = quotations.length;
        const sent322 = quotations.filter(q => ['sent','accepted','rejected','converted'].includes((q.status||'').toLowerCase())).length;
        const accepted322 = quotations.filter(q => ['accepted','converted'].includes((q.status||'').toLowerCase())).length;
        const converted322 = quotations.filter(q => (q.status||'').toLowerCase() === 'converted').length;
        const stages = [
          { label: 'Created', count: total322, color: '#6366f1' },
          { label: 'Sent',    count: sent322,  color: '#3b82f6' },
          { label: 'Accepted',count: accepted322, color: '#10b981' },
          { label: 'Converted',count: converted322, color: '#f59e0b' },
        ];
        const convRate = total322 > 0 ? ((converted322 / total322) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quotation Conversion Funnel</h3>
            <p className="text-xs text-gray-500 mb-4">End-to-end pipeline from quote creation to order · Overall conversion: {convRate}%</p>
            <div className="flex items-end gap-2 h-28">
              {stages.map((s, i) => {
                const h = total322 > 0 ? Math.max((s.count / total322) * 100, 4) : 4;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-bold" style={{color: s.color}}>{s.count}</span>
                    <div className="w-full rounded-t-lg transition-all" style={{height: `${h}%`, background: s.color}} />
                    <span className="text-[10px] text-gray-500 text-center">{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const ltvMap: Record<string, number> = {};
        orders.forEach(o => {
          const cust = o.customerName || 'Unknown';
          ltvMap[cust] = (ltvMap[cust] || 0) + (o.totalPrice || 0);
        });
        const ltvValues = Object.values(ltvMap);
        if (ltvValues.length < 3) return null;
        const buckets = [
          {label: '< ₺10K',   min: 0,      max: 10000,   color: '#94a3b8', count: 0, total: 0},
          {label: '₺10–50K',  min: 10000,  max: 50000,   color: '#6366f1', count: 0, total: 0},
          {label: '₺50–200K', min: 50000,  max: 200000,  color: '#3b82f6', count: 0, total: 0},
          {label: '₺200K+',   min: 200000, max: Infinity, color: '#10b981', count: 0, total: 0},
        ];
        ltvValues.forEach(v => {
          const b = buckets.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.total += v; }
        });
        const maxCount = Math.max(...buckets.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Customer LTV Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Lifetime value buckets across {ltvValues.length} customers</p>
            <div className="flex items-end gap-3 h-24">
              {buckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxCount) * 72, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs331 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const seenBefore: Record<string, string> = {};
        const monthData: Record<string, {newC: number; ret: number}> = {};
        [...orders].sort((a, b) => toTs331(a.createdAt) - toTs331(b.createdAt)).forEach(o => {
          const d = new Date(toTs331(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthData[key]) monthData[key] = {newC: 0, ret: 0};
          const cust = o.customerName || 'Unknown';
          if (seenBefore[cust]) monthData[key].ret++;
          else { monthData[key].newC++; seenBefore[cust] = key; }
        });
        const keys331 = Object.keys(monthData).sort().slice(-6);
        if (keys331.length < 2) return null;
        const maxVal = Math.max(...keys331.map(k => monthData[k].newC + monthData[k].ret), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">New vs Returning Customers</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly breakdown — stacked bars by customer type</p>
            <div className="flex items-end gap-2 h-28 mb-2">
              {keys331.map(k => {
                const {newC, ret} = monthData[k];
                const total = newC + ret;
                const newH = maxVal > 0 ? (newC / maxVal) * 96 : 0;
                const retH = maxVal > 0 ? (ret / maxVal) * 96 : 0;
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-0">
                    <span className="text-[9px] text-gray-500 mb-0.5">{total}</span>
                    <div className="w-full flex flex-col justify-end rounded-t overflow-hidden" style={{height: '80px'}}>
                      <div style={{height: `${retH}px`, background: '#6366f1'}} />
                      <div style={{height: `${newH}px`, background: '#10b981'}} />
                    </div>
                    <span className="text-[9px] text-gray-400 mt-0.5">{k.slice(5)}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4">
              {[{color:'#10b981', label:'New'},{color:'#6366f1', label:'Returning'}].map((s,i)=>(
                <div key={i} className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{background:s.color}}/><span className="text-[10px] text-gray-500">{s.label}</span></div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const repMap: Record<string, {orders: number; revenue: number}> = {};
        orders.forEach(o => {
          const rep = (o as unknown as Record<string,unknown>).salesRep as string || (o as unknown as Record<string,unknown>).assignedTo as string || '';
          if (!rep) return;
          if (!repMap[rep]) repMap[rep] = {orders: 0, revenue: 0};
          repMap[rep].orders++;
          repMap[rep].revenue += o.totalPrice || 0;
        });
        const reps333 = Object.entries(repMap).map(([rep, d]) => ({rep, ...d})).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
        if (reps333.length < 2) return null;
        const maxRev333 = Math.max(...reps333.map(r => r.revenue), 1);
        const colors333 = ['#f59e0b','#6366f1','#3b82f6','#10b981','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Sales Representatives</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count by assigned sales rep</p>
            <div className="space-y-2">
              {reps333.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{r.rep}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(r.revenue / maxRev333) * 100}%`, background: colors333[i % colors333.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{r.orders} ord</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors333[i % colors333.length]}}>{fmtAna(r.revenue,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const buckets336 = [
          {label: 'Micro\n<₺1K',   min: 0,    max: 1000,   color: '#94a3b8'},
          {label: 'Small\n₺1–5K',  min: 1000,  max: 5000,   color: '#6366f1'},
          {label: 'Mid\n₺5–20K',   min: 5000,  max: 20000,  color: '#3b82f6'},
          {label: 'Large\n₺20K+',  min: 20000, max: Infinity, color: '#10b981'},
        ];
        buckets336.forEach(b => { (b as unknown as Record<string,unknown>).count = 0; (b as unknown as Record<string,unknown>).rev = 0; });
        const bData = buckets336.map(b => ({...b, count: 0, rev: 0}));
        orders.forEach(o => {
          const v = o.totalPrice || 0;
          const b = bData.find(b => v >= b.min && v < b.max);
          if (b) { b.count++; b.rev += v; }
        });
        const maxCount336 = Math.max(...bData.map(b => b.count), 1);
        const totalRev336 = bData.reduce((s, b) => s + b.rev, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Size Distribution</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by order value tier · {orders.length} orders total</p>
            <div className="flex items-end gap-3 h-24 mb-2">
              {bData.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((b.count / maxCount336) * 72, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center whitespace-pre-line leading-tight">{b.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap mt-1">
              {bData.map((b, i) => (
                <span key={i} className="text-[10px] text-gray-400">{b.label.split('\n')[0]}: {totalRev336 > 0 ? ((b.rev / totalRev336) * 100).toFixed(0) : 0}% rev</span>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const statusCount340: Record<string, {count: number; value: number}> = {};
        quotations.forEach(q => {
          const s = (q.status || 'draft');
          if (!statusCount340[s]) statusCount340[s] = {count: 0, value: 0};
          statusCount340[s].count++;
          statusCount340[s].value += (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
        });
        const colors340: Record<string, string> = {draft:'#94a3b8',sent:'#6366f1',accepted:'#10b981',rejected:'#ef4444',converted:'#f59e0b',expired:'#f97316'};
        const stages340 = Object.entries(statusCount340).map(([s, d]) => ({label: s, ...d})).sort((a, b) => b.count - a.count);
        if (stages340.length < 2) return null;
        const maxCount340 = Math.max(...stages340.map(s => s.count), 1);
        const acceptedRev = (statusCount340['accepted']?.value || 0) + (statusCount340['converted']?.value || 0);
        const totalRev340 = Object.values(statusCount340).reduce((s, d) => s + d.value, 0);
        const convPct = totalRev340 > 0 ? ((acceptedRev / totalRev340) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quotation Status Breakdown</h3>
            <p className="text-xs text-gray-500 mb-4">{quotations.length} quotes · Accepted/Converted revenue: {convPct}% of pipeline</p>
            <div className="space-y-2">
              {stages340.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20 capitalize">{s.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(s.count / maxCount340) * 100}%`, background: colors340[s.label] || '#94a3b8'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right" style={{color: colors340[s.label] || '#94a3b8'}}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 5 && (() => {
        const custQMap: Record<string, {won: number; lost: number; total: number}> = {};
        quotations.forEach(q => {
          const c = q.customerName || 'Unknown';
          if (!custQMap[c]) custQMap[c] = {won: 0, lost: 0, total: 0};
          custQMap[c].total++;
          if (['accepted','converted'].includes((q.status||'').toLowerCase())) custQMap[c].won++;
          if ((q.status||'').toLowerCase() === 'rejected') custQMap[c].lost++;
        });
        const custQ343 = Object.entries(custQMap).map(([c, d]) => ({customer: c, ...d, winRate: d.total > 0 ? (d.won / d.total) * 100 : 0})).filter(d => d.total >= 2).sort((a, b) => b.total - a.total).slice(0, 6);
        if (custQ343.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quote Win Rate by Customer</h3>
            <p className="text-xs text-gray-500 mb-4">Accepted ÷ total quotes per customer</p>
            <div className="space-y-2">
              {custQ343.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{c.customer}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full" style={{width: `${c.winRate}%`, background: c.winRate >= 60 ? '#10b981' : c.winRate >= 30 ? '#f59e0b' : '#ef4444'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{c.total} qt</span>
                  <span className="text-xs font-bold w-10 text-right" style={{color: c.winRate >= 60 ? '#10b981' : c.winRate >= 30 ? '#f59e0b' : '#ef4444'}}>{c.winRate.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs353 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const custOrders: Record<string, number[]> = {};
        orders.forEach(o => {
          const c = o.customerName || 'Unknown';
          const ts = toTs353(o.createdAt);
          if (!ts) return;
          if (!custOrders[c]) custOrders[c] = [];
          custOrders[c].push(ts);
        });
        const gaps = Object.entries(custOrders)
          .filter(([, ts]) => ts.length >= 2)
          .map(([customer, timestamps]) => {
            const sorted = [...timestamps].sort((a, b) => a - b);
            const avgGap = sorted.slice(1).reduce((s, t, i) => s + (t - sorted[i]) / 86400000, 0) / (sorted.length - 1);
            return { customer, avgGap: Math.round(avgGap), orders: sorted.length };
          })
          .sort((a, b) => b.orders - a.orders)
          .slice(0, 7);
        if (gaps.length < 2) return null;
        const maxGap = Math.max(...gaps.map(g => g.avgGap), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Avg Days Between Orders</h3>
            <p className="text-xs text-gray-500 mb-4">Repeat customer purchase cadence — shorter gap = higher loyalty</p>
            <div className="space-y-2">
              {gaps.map((g, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{g.customer}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(g.avgGap / maxGap) * 100}%`, background: g.avgGap <= 14 ? '#10b981' : g.avgGap <= 45 ? '#f59e0b' : '#ef4444'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{g.orders}×</span>
                  <span className="text-xs font-bold w-14 text-right" style={{color: g.avgGap <= 14 ? '#10b981' : g.avgGap <= 45 ? '#f59e0b' : '#ef4444'}}>{g.avgGap}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const pipeline: Record<string, number> = {};
        quotations.forEach(q => {
          const s = (q.status || 'draft').toLowerCase();
          const val = (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
          pipeline[s] = (pipeline[s] || 0) + val;
        });
        const statusOrder = ['draft','sent','accepted','converted','rejected'];
        const pipelineData = statusOrder.map(s => ({status: s, value: pipeline[s] || 0})).filter(d => d.value > 0);
        if (pipelineData.length < 2) return null;
        const totalPipeline = pipelineData.reduce((s, d) => s + d.value, 0);
        const colors357: Record<string, string> = {draft:'#94a3b8',sent:'#6366f1',accepted:'#10b981',converted:'#f59e0b',rejected:'#ef4444'};
        const maxVal357 = Math.max(...pipelineData.map(d => d.value), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Quote Value Pipeline</h3>
            <p className="text-xs text-gray-500 mb-4">Total pipeline: {fmtAna(totalPipeline,'full',0)}</p>
            <div className="space-y-2">
              {pipelineData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-20 capitalize">{d.status}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(d.value / maxVal357) * 100}%`, background: colors357[d.status] || '#94a3b8'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{totalPipeline > 0 ? ((d.value / totalPipeline) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors357[d.status] || '#94a3b8'}}>{fmtAna(d.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const custCount: Record<string, number> = {};
        orders.forEach(o => { const c = o.customerName || 'Unknown'; custCount[c] = (custCount[c] || 0) + 1; });
        const counts = Object.values(custCount);
        if (counts.length < 3) return null;
        const buckets359 = [
          {label: '1 order',  min: 1, max: 1,   count: 0, color: '#94a3b8'},
          {label: '2–3',      min: 2, max: 3,   count: 0, color: '#6366f1'},
          {label: '4–6',      min: 4, max: 6,   count: 0, color: '#3b82f6'},
          {label: '7–10',     min: 7, max: 10,  count: 0, color: '#10b981'},
          {label: '11+',      min: 11, max: 999, count: 0, color: '#f59e0b'},
        ];
        counts.forEach(c => { const b = buckets359.find(b => c >= b.min && c <= b.max); if (b) b.count++; });
        const maxB359 = Math.max(...buckets359.map(b => b.count), 1);
        const totalCusts = counts.length;
        const repeatPct = ((counts.filter(c => c > 1).length / totalCusts) * 100).toFixed(0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Orders per Customer</h3>
            <p className="text-xs text-gray-500 mb-4">{totalCusts} unique customers · <span className="font-bold text-[#ff4000]">{repeatPct}%</span> repeat buyers</p>
            <div className="flex items-end gap-3 h-20">
              {buckets359.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxB359) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 4 && (() => {
        const toTs362 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthQV: Record<string, {total: number; count: number}> = {};
        quotations.forEach(q => {
          const ts = toTs362((q as unknown as Record<string,unknown>).createdAt);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const val = (q as unknown as Record<string,unknown>).totalPrice as number || (q as unknown as Record<string,unknown>).total as number || 0;
          if (!monthQV[key]) monthQV[key] = {total: 0, count: 0};
          monthQV[key].total += val;
          monthQV[key].count++;
        });
        const keys362 = Object.keys(monthQV).sort().slice(-7);
        if (keys362.length < 2) return null;
        const avgData = keys362.map(k => ({k, avg: monthQV[k].count > 0 ? monthQV[k].total / monthQV[k].count : 0, count: monthQV[k].count}));
        const maxAvg362 = Math.max(...avgData.map(d => d.avg), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Avg Quote Value Over Time</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly average quotation value trend</p>
            <div className="flex items-end gap-2 h-24">
              {avgData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.count}</span>
                  <div className="w-full rounded-t-lg bg-violet-400 transition-all" style={{height: `${Math.max((d.avg / maxAvg362) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const segRev: Record<string, number> = {};
        orders.forEach(o => {
          const seg = (o as unknown as Record<string,unknown>).customerSegment as string || (o as unknown as Record<string,unknown>).segment as string || (o as unknown as Record<string,unknown>).customerType as string || 'Standard';
          segRev[seg] = (segRev[seg] || 0) + (o.totalPrice || 0);
        });
        const segs370 = Object.entries(segRev).map(([seg, rev]) => ({seg, rev})).sort((a, b) => b.rev - a.rev);
        if (segs370.length < 2) return null;
        const totalRev370 = segs370.reduce((s, d) => s + d.rev, 0);
        const colors370 = ['#6366f1','#10b981','#f59e0b','#3b82f6','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Revenue by Customer Segment</h3>
            <p className="text-xs text-gray-500 mb-4">Total: {fmtAna(totalRev370,'full',0)}</p>
            <div className="space-y-2">
              {segs370.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-24 truncate">{s.seg}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${totalRev370 > 0 ? (s.rev / totalRev370) * 100 : 0}%`, background: colors370[i % colors370.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev370 > 0 ? ((s.rev / totalRev370) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors370[i % colors370.length]}}>{fmtAna(s.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const sourceMap: Record<string, {count: number; rev: number}> = {};
        orders.forEach(o => {
          const src = (o as unknown as Record<string,unknown>).source as string || (o as unknown as Record<string,unknown>).channel as string || (o as unknown as Record<string,unknown>).orderSource as string || 'Direct';
          if (!sourceMap[src]) sourceMap[src] = {count: 0, rev: 0};
          sourceMap[src].count++;
          sourceMap[src].rev += o.totalPrice || 0;
        });
        const sources = Object.entries(sourceMap).map(([src, d]) => ({src, ...d})).sort((a, b) => b.rev - a.rev);
        if (sources.length < 2) return null;
        const totalRev373 = sources.reduce((s, d) => s + d.rev, 0);
        const colors373 = ['#6366f1','#10b981','#f59e0b','#3b82f6','#f97316','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Source Mix</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue share by acquisition channel</p>
            <div className="space-y-2">
              {sources.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: colors373[i % colors373.length]}} />
                  <span className="text-xs text-gray-700 flex-1 truncate">{s.src}</span>
                  <div className="w-28 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${totalRev373 > 0 ? (s.rev / totalRev373) * 100 : 0}%`, background: colors373[i % colors373.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{totalRev373 > 0 ? ((s.rev / totalRev373) * 100).toFixed(0) : 0}%</span>
                  <span className="text-xs font-bold w-20 text-right" style={{color: colors373[i % colors373.length]}}>{fmtAna(s.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs377 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const firstOrder: Record<string, string> = {};
        [...orders].sort((a, b) => toTs377(a.createdAt) - toTs377(b.createdAt)).forEach(o => {
          if (!firstOrder[o.customerName]) firstOrder[o.customerName] = (() => {
            const d = new Date(toTs377(o.createdAt));
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          })();
        });
        const monthNew: Record<string, number> = {};
        Object.values(firstOrder).forEach(k => { monthNew[k] = (monthNew[k] || 0) + 1; });
        const keys377 = Object.keys(monthNew).sort().slice(-8);
        if (keys377.length < 3) return null;
        const maxNew = Math.max(...keys377.map(k => monthNew[k]), 1);
        const totalNew = keys377.reduce((s, k) => s + monthNew[k], 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">New Customer Acquisition</h3>
            <p className="text-xs text-gray-500 mb-4">{totalNew} new customers across shown period</p>
            <div className="flex items-end gap-2 h-24">
              {keys377.map(k => (
                <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{monthNew[k]}</span>
                  <div className="w-full rounded-t-lg bg-fuchsia-400 transition-all" style={{height: `${Math.max((monthNew[k] / maxNew) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const toTs378 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthData378: Record<string, {orders: number; customers: Set<string>}> = {};
        orders.forEach(o => {
          const d = new Date(toTs378(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthData378[key]) monthData378[key] = {orders: 0, customers: new Set()};
          monthData378[key].orders++;
          monthData378[key].customers.add(o.customerName || 'Unknown');
        });
        const keys378 = Object.keys(monthData378).sort().slice(-7);
        if (keys378.length < 3) return null;
        const avgPerCust = keys378.map(k => ({k, avg: monthData378[k].customers.size > 0 ? monthData378[k].orders / monthData378[k].customers.size : 0}));
        const maxAvg378 = Math.max(...avgPerCust.map(d => d.avg), 1);
        const overallAvg378 = avgPerCust.reduce((s, d) => s + d.avg, 0) / avgPerCust.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Avg Orders per Customer / Month</h3>
            <p className="text-xs text-gray-500 mb-4">Purchase frequency trend · Avg: {overallAvg378.toFixed(2)} orders/customer</p>
            <div className="flex items-end gap-2 h-24">
              {avgPerCust.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.avg.toFixed(1)}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((d.avg / maxAvg378) * 72, 4)}px`, background: d.avg >= overallAvg378 ? '#10b981' : '#6366f1'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const spend: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oRec = o as unknown as Record<string,unknown>;
          const total = typeof oRec.total === 'number' ? oRec.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number | undefined) ?? 0) * ((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0); }, 0);
          spend[cid] = (spend[cid] ?? 0) + total;
        });
        const vals = Object.values(spend).sort((a, b) => b - a);
        if (vals.length < 3) return null;
        const tiers = [
          { label: 'Platinum', color: '#8b5cf6', min: vals[0] * 0.5 },
          { label: 'Gold',     color: '#f59e0b', min: vals[0] * 0.2 },
          { label: 'Silver',   color: '#6b7280', min: vals[0] * 0.05 },
          { label: 'Bronze',   color: '#b45309', min: 0 },
        ];
        const tierBuckets = tiers.map((t, i) => ({
          ...t,
          count: vals.filter(v => v >= t.min && (i === 0 || v < tiers[i - 1].min)).length,
        }));
        const maxC = Math.max(...tierBuckets.map(t => t.count), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Customer Lifetime Value Tiers</h3>
            <div className="space-y-2">
              {tierBuckets.map(t => (
                <div key={t.label} className="flex items-center gap-2">
                  <span className="text-xs w-16 font-medium" style={{color: t.color}}>{t.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2 transition-all" style={{width: `${(t.count / maxC) * 100}%`, background: t.color}}>
                      <span className="text-white text-xs font-bold">{t.count > 0 ? t.count : ''}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right">{t.count} cust</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && orders.length >= 3 && (() => {
        const monthOrders: Record<string, Set<string>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthOrders[key]) monthOrders[key] = new Set();
          const qid = (o as unknown as Record<string,unknown>).quotationId as string | undefined;
          if (qid) monthOrders[key].add(qid);
        });
        const monthQuotes: Record<string, number> = {};
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          monthQuotes[key] = (monthQuotes[key] ?? 0) + 1;
        });
        const months = Object.keys(monthQuotes).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m => ({
          month: m.slice(5),
          quotes: monthQuotes[m] ?? 0,
          converted: (monthOrders[m]?.size ?? 0),
          rate: monthQuotes[m] > 0 ? Math.round(((monthOrders[m]?.size ?? 0) / monthQuotes[m]) * 100) : 0,
        }));
        const maxR = Math.max(...rows.map(r => r.rate), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Quote → Order Conversion Rate by Month</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.rate}%</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.rate / maxR) * 64}px`, background: r.rate >= 50 ? '#22c55e' : r.rate >= 25 ? '#f59e0b' : '#ef4444', minHeight: r.rate > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {total: number; cancelled: number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key] = {total: 0, cancelled: 0};
          byMonth[key].total++;
          if (o.status === 'Cancelled' || (o.status as string) === 'İptal') byMonth[key].cancelled++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m => ({
          month: m.slice(5),
          rate: byMonth[m].total > 0 ? Math.round((byMonth[m].cancelled / byMonth[m].total) * 100) : 0,
          total: byMonth[m].total,
          cancelled: byMonth[m].cancelled,
        }));
        const maxR = Math.max(...rows.map(r => r.rate), 1);
        const totalCancelled = rows.reduce((s, r) => s + r.cancelled, 0);
        const totalOrders = rows.reduce((s, r) => s + r.total, 0);
        const overallRate = totalOrders > 0 ? ((totalCancelled / totalOrders) * 100).toFixed(1) : '0';
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Order Cancellation Rate</h3>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{overallRate}% overall</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.rate}%</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.rate / maxR) * 56}px`, background: r.rate >= 20 ? '#ef4444' : r.rate >= 10 ? '#f59e0b' : '#22c55e', minHeight: r.rate > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const ordersByCustomer: Record<string, Date[]> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          if (!ordersByCustomer[cid]) ordersByCustomer[cid] = [];
          ordersByCustomer[cid].push(d);
        });
        const gaps: number[] = [];
        Object.values(ordersByCustomer).forEach(dates => {
          if (dates.length < 2) return;
          dates.sort((a, b) => a.getTime() - b.getTime());
          for (let i = 1; i < dates.length; i++) {
            const gap = Math.round((dates[i].getTime() - dates[i-1].getTime()) / 86400000);
            if (gap > 0 && gap <= 365) gaps.push(gap);
          }
        });
        if (gaps.length < 3) return null;
        const avg = gaps.reduce((a,b) => a+b, 0) / gaps.length;
        const buckets = [[1,7,'1-7d'],[8,14,'8-14d'],[15,30,'15-30d'],[31,60,'1-2mo'],[61,90,'2-3mo'],[91,365,'3mo+']];
        const counts = buckets.map(([lo,hi,lbl]) => ({ label: lbl as string, count: gaps.filter(g => g >= (lo as number) && g <= (hi as number)).length }));
        const maxC = Math.max(...counts.map(c => c.count), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Avg Days Between Orders</h3>
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">{avg.toFixed(0)}d avg</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {counts.map(c => (
                <div key={c.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{c.count > 0 ? c.count : ''}</span>
                  <div className="w-full rounded-sm" style={{height: `${(c.count / maxC) * 56}px`, background: '#a78bfa', minHeight: c.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custOrders: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!custOrders[cid]) custOrders[cid] = {count: 0, revenue: 0};
          custOrders[cid].count++;
          custOrders[cid].revenue += total;
        });
        const top5 = Object.entries(custOrders).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
        if (top5.length === 0) return null;
        const maxC = top5[0][1].count;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top 5 Customers by Order Count</h3>
            <div className="space-y-2">
              {top5.map(([name, d], i) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-4 text-gray-400">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(d.count / maxC) * 100}%`, background: '#ff4000'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right text-brand">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const custFirstOrder: Record<string, {date: Date; value: number}> = {};
        const allCustomerOrders: Record<string, {date: Date; value: number}[]> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!allCustomerOrders[cid]) allCustomerOrders[cid] = [];
          allCustomerOrders[cid].push({date: d, value: total});
        });
        const firstOrderVals: number[] = [];
        const repeatOrderVals: number[] = [];
        Object.values(allCustomerOrders).forEach(oList => {
          oList.sort((a, b) => a.date.getTime() - b.date.getTime());
          if (oList.length > 0) firstOrderVals.push(oList[0].value);
          if (oList.length > 1) oList.slice(1).forEach(o => repeatOrderVals.push(o.value));
        });
        if (firstOrderVals.length < 2) return null;
        const avgFirst = firstOrderVals.reduce((a,b) => a+b, 0) / firstOrderVals.length;
        const avgRepeat = repeatOrderVals.length > 0 ? repeatOrderVals.reduce((a,b) => a+b, 0) / repeatOrderVals.length : 0;
        const maxVal = Math.max(avgFirst, avgRepeat, 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">First vs Repeat Order Value</h3>
            <div className="space-y-3">
              {[{label:'1st Order Avg', val: avgFirst, color: '#3b82f6', n: firstOrderVals.length},
                {label:'Repeat Avg', val: avgRepeat, color: '#22c55e', n: repeatOrderVals.length}].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600">{r.label}</span>
                    <span className="font-bold" style={{color: r.color}}>{fmtAna(r.val,'full',0)} <span className="font-normal text-gray-400">({r.n})</span></span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(r.val / maxVal) * 100}%`, background: r.color}} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {lost: number; count: number}> = {};
        orders.forEach(o => {
          if (o.status !== 'Cancelled' && (o.status as string) !== 'İptal') return;
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!byMonth[key]) byMonth[key] = {lost: 0, count: 0};
          byMonth[key].lost += total;
          byMonth[key].count++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm font-medium text-green-700">No cancelled orders — 0 lost revenue</span>
          </div>
        );
        const maxLost = Math.max(...months.map(m => byMonth[m].lost), 1);
        const totalLost = months.reduce((s, m) => s + byMonth[m].lost, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Lost Revenue (Cancellations)</h3>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{fmtAna(totalLost,'K',1)} total</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m => (
                <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{byMonth[m].count}</span>
                  <div className="w-full rounded-sm" style={{height: `${(byMonth[m].lost / maxLost) * 56}px`, background: '#ef4444', minHeight: byMonth[m].lost > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const productCustomers: Record<string, Set<string>> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          (o.lineItems ?? []).forEach(li => {
            const liR = li as unknown as Record<string,unknown>;
            const name = (liR.productName as string | undefined) ?? (liR.name as string | undefined) ?? 'Unknown';
            if (!productCustomers[name]) productCustomers[name] = new Set();
            productCustomers[name].add(cid);
          });
        });
        const top = Object.entries(productCustomers)
          .sort((a, b) => b[1].size - a[1].size)
          .slice(0, 6);
        if (top.length === 0) return null;
        const maxSize = top[0][1].size;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Products by Customer Reach</h3>
            <div className="space-y-2">
              {top.map(([name, custSet]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(custSet.size / maxSize) * 100}%`, background: '#8b5cf6'}} />
                  </div>
                  <span className="text-xs font-bold w-8 text-right text-purple-600">{custSet.size}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now = new Date();
        const lastOrderByCustomer: Record<string, Date> = {};
        const revenueByCustomer: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerName as string | undefined
            || (o as unknown as Record<string,unknown>).customerId as string | undefined
            || 'Unknown';
          if (!lastOrderByCustomer[cid] || d > lastOrderByCustomer[cid]) lastOrderByCustomer[cid] = d;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          revenueByCustomer[cid] = (revenueByCustomer[cid] ?? 0) + total;
        });
        const churnRisk = Object.entries(lastOrderByCustomer)
          .map(([cid, lastDate]) => ({
            name: cid,
            daysSince: Math.floor((now.getTime() - lastDate.getTime()) / 86400000),
            revenue: revenueByCustomer[cid] ?? 0,
          }))
          .filter(c => c.daysSince >= 90)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 6);
        if (churnRisk.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm font-medium text-green-700">All customers active within 90 days</span>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>⚠️ Churn Risk (&gt;90d no order)</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{churnRisk.length}</span>
            </h3>
            <div className="space-y-2">
              {churnRisk.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{c.name}</span>
                  <span className="text-gray-400 mx-2">{fmtAna(c.revenue,'K',0)}</span>
                  <span className="font-bold" style={{color: c.daysSince >= 180 ? '#ef4444' : '#f59e0b'}}>{c.daysSince}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const hourCounts = new Array(24).fill(0);
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          hourCounts[d.getHours()]++;
        });
        const maxH = Math.max(...hourCounts, 1);
        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
        const businessHours = hourCounts.slice(8, 19);
        const businessTotal = businessHours.reduce((a,b) => a+b, 0);
        const totalOrders = hourCounts.reduce((a,b) => a+b, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Orders by Hour</h3>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">Peak: {peakHour}:00</span>
            </div>
            <div className="flex items-end gap-0.5 h-16">
              {hourCounts.map((count, h) => (
                <div key={h} className="flex-1 rounded-sm transition-all" style={{
                  height: `${(count / maxH) * 52}px`,
                  background: h === peakHour ? '#ff4000' : h >= 8 && h <= 18 ? '#3b82f6' : '#d1d5db',
                  minHeight: count > 0 ? 1 : 0,
                }} title={`${h}:00 — ${count} orders`} />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>00:00</span><span>12:00</span><span>23:00</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1 text-center">{totalOrders > 0 ? Math.round((businessTotal/totalOrders)*100) : 0}% during business hours (8-18)</p>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custRevenue: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerName as string | undefined
            || (o as unknown as Record<string,unknown>).customerId as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          custRevenue[cid] = (custRevenue[cid] ?? 0) + total;
        });
        const sorted = Object.values(custRevenue).sort((a, b) => b - a);
        if (sorted.length < 3) return null;
        const totalRev = sorted.reduce((a,b) => a+b, 0);
        const top20Count = Math.max(1, Math.ceil(sorted.length * 0.2));
        const top20Rev = sorted.slice(0, top20Count).reduce((a,b) => a+b, 0);
        const top20Pct = totalRev > 0 ? Math.round((top20Rev / totalRev) * 100) : 0;
        // Build cumulative Pareto data
        let cumRev = 0;
        const paretoPoints = sorted.map((v, i) => {
          cumRev += v;
          return { custPct: Math.round(((i+1)/sorted.length)*100), revPct: Math.round((cumRev/totalRev)*100) };
        });
        const w = 240; const h = 60; const pad = 8;
        const pts = paretoPoints.map(p => `${pad + (p.custPct / 100) * (w-2*pad)},${h - pad - (p.revPct / 100) * (h-2*pad)}`).join(' ');
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Revenue Pareto</h3>
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">Top 20% → {top20Pct}% revenue</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height: 60}}>
              <line x1={pad} y1={pad} x2={w-pad} y2={h-pad} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4" />
              <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <line x1={pad + 0.2*(w-2*pad)} y1={pad} x2={pad + 0.2*(w-2*pad)} y2={h-pad} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 3" />
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>0% customers</span><span>100%</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthCustomers = new Set<string>();
        const allTimeCustomers = new Set<string>();
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          if (d && d < thisMonthStart) allTimeCustomers.add(cid);
          if (d && d >= thisMonthStart) thisMonthCustomers.add(cid);
        });
        const returning = [...thisMonthCustomers].filter(c => allTimeCustomers.has(c)).length;
        const newCust = thisMonthCustomers.size - returning;
        const total = thisMonthCustomers.size;
        if (total === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">New vs Returning (This Month)</h3>
            <div className="flex h-5 rounded-full overflow-hidden mb-3">
              <div style={{width: `${(newCust/total)*100}%`, background: '#ff4000'}} />
              <div style={{width: `${(returning/total)*100}%`, background: '#3b82f6'}} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              {[{label:'New', count: newCust, color:'#ff4000'},{label:'Returning', count: returning, color:'#3b82f6'}].map(s => (
                <div key={s.label} className="rounded-xl p-2" style={{background: `${s.color}12`}}>
                  <p className="text-2xl font-bold" style={{color: s.color}}>{s.count}</p>
                  <p className="text-[10px] text-gray-500">{s.label} ({total > 0 ? Math.round((s.count/total)*100) : 0}%)</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 3 && quotations.length >= 2 && (() => {
        const ordersByMonth: Record<string, number> = {};
        const quotesByMonth: Record<string, number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          ordersByMonth[key] = (ordersByMonth[key] ?? 0) + 1;
        });
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          quotesByMonth[key] = (quotesByMonth[key] ?? 0) + 1;
        });
        const allMonths = [...new Set([...Object.keys(ordersByMonth), ...Object.keys(quotesByMonth)])].sort().slice(-6);
        if (allMonths.length < 2) return null;
        const maxVal = Math.max(...allMonths.map(m => Math.max(ordersByMonth[m]??0, quotesByMonth[m]??0)), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Orders vs Quotations by Month</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {allMonths.map(m => (
                <div key={m} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height: `${((ordersByMonth[m]??0)/maxVal)*72}px`, background: '#ff4000', minHeight: (ordersByMonth[m]??0) > 0 ? 2 : 0}} />
                  <div className="flex-1 rounded-sm" style={{height: `${((quotesByMonth[m]??0)/maxVal)*72}px`, background: '#3b82f680', minHeight: (quotesByMonth[m]??0) > 0 ? 2 : 0}} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-1">
              {allMonths.map(m => <span key={m} className="flex-1 text-center text-[9px] text-gray-400">{m.slice(5)}</span>)}
            </div>
            <div className="flex gap-3 justify-center text-[10px]">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-brand" /><span className="text-gray-500">Orders</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-400" /><span className="text-gray-500">Quotes</span></div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custOrderCount: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string|undefined
            || (o as unknown as Record<string,unknown>).customerName as string|undefined || 'Unknown';
          custOrderCount[cid] = (custOrderCount[cid] ?? 0) + 1;
        });
        const total = Object.keys(custOrderCount).length;
        const repeating = Object.values(custOrderCount).filter(c => c > 1).length;
        const rate = total > 0 ? Math.round((repeating / total) * 100) : 0;
        const avgOrdersPerRepeat = repeating > 0
          ? (Object.values(custOrderCount).filter(c=>c>1).reduce((a,b)=>a+b,0)/repeating).toFixed(1)
          : '0';
        // Monthly repeat rate trend
        const monthSeen: Record<string, Set<string>> = {};
        const monthRepeat: Record<string, number> = {};
        const custFirstMonth: Record<string, string> = {};
        [...orders].sort((a,b)=>{
          const da = a.createdAt ? ((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)) : new Date(0);
          const db = b.createdAt ? ((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)) : new Date(0);
          return da.getTime()-db.getTime();
        }).forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const cid = (o as unknown as Record<string,unknown>).customerId as string|undefined || (o as unknown as Record<string,unknown>).customerName as string|undefined || 'Unknown';
          if (!custFirstMonth[cid]) custFirstMonth[cid] = key;
          if (!monthSeen[key]) { monthSeen[key] = new Set(); monthRepeat[key] = 0; }
          if (custFirstMonth[cid] < key) monthRepeat[key]++;
          monthSeen[key].add(cid);
        });
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Repeat Purchase Rate</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <p className="text-3xl font-bold text-brand">{rate}%</p>
                <p className="text-[10px] text-gray-500">of customers repeat</p>
              </div>
              <div className="flex-1">
                <div className="bg-gray-100 rounded-full h-4 overflow-hidden mb-1">
                  <div className="h-full rounded-full bg-brand transition-all" style={{width:`${rate}%`}} />
                </div>
                <p className="text-xs text-gray-500">{repeating}/{total} customers • avg {avgOrdersPerRepeat} orders</p>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const segmentData: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const segment = (oR.customerType as string|undefined) ?? (oR.segment as string|undefined)
            ?? (oR.type as string|undefined) ?? 'Standard';
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!segmentData[segment]) segmentData[segment] = {count: 0, revenue: 0};
          segmentData[segment].count++;
          segmentData[segment].revenue += total;
        });
        const rows = Object.entries(segmentData).sort((a,b)=>b[1].revenue-a[1].revenue);
        if (rows.length <= 1) {
          // Single segment — show order size distribution instead
          const sizes = orders.map(o => (o.lineItems??[]).length).filter(n=>n>0);
          const avg = sizes.length > 0 ? (sizes.reduce((a,b)=>a+b,0)/sizes.length).toFixed(1) : '0';
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">Order Size Summary</h3>
              <p className="text-3xl font-bold text-brand">{avg}</p>
              <p className="text-xs text-gray-500">avg line items per order ({orders.length} orders)</p>
            </div>
          );
        }
        const totalRev = rows.reduce((s,[,d])=>s+d.revenue,0);
        const palette = ['#ff4000','#3b82f6','#22c55e','#f59e0b','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue by Customer Segment</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([seg,d],i)=><div key={seg} style={{width:`${(d.revenue/totalRev)*100}%`,background:palette[i]}} title={seg} />)}
            </div>
            <div className="space-y-1">
              {rows.map(([seg,d],i) => (
                <div key={seg} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background:palette[i]}} />
                    <span className="text-gray-600">{seg}</span>
                  </div>
                  <span className="font-bold">{d.count} <span className="font-normal text-gray-400">({totalRev>0?Math.round((d.revenue/totalRev)*100):0}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 1 && (() => {
        const active = quotations.filter(q => {
          const s = ((q as unknown as Record<string,unknown>).status as string|undefined) ?? '';
          return !['Rejected','Expired','Converted','Cancelled'].includes(s);
        });
        const totalValue = active.reduce((s, q) => {
          const qR = q as unknown as Record<string,unknown>;
          const val = (qR.totalAmount as number|undefined) ?? (qR.total as number|undefined) ?? 0;
          return s + val;
        }, 0);
        const byStatus: Record<string,number> = {};
        quotations.forEach(q => {
          const s = ((q as unknown as Record<string,unknown>).status as string|undefined) ?? 'Draft';
          byStatus[s] = (byStatus[s]??0)+1;
        });
        const statusRows = Object.entries(byStatus).sort((a,b)=>b[1]-a[1]);
        const statusColors: Record<string,string> = {'Draft':'#94a3b8','Sent':'#3b82f6','Pending':'#f59e0b','Approved':'#22c55e','Rejected':'#ef4444','Converted':'#8b5cf6','Expired':'#6b7280'};
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Quotation Pipeline</h3>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{active.length} active • {fmtAna(totalValue,'K',0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {statusRows.map(([s,n]) => (
                <div key={s} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:statusColors[s]??'#6b7280'}} />
                  <span className="text-gray-600 truncate">{s}</span>
                  <span className="ml-auto font-bold">{n}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const byMonth: Record<string,{count:number;value:number}> = {};
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key]={count:0,value:0};
          byMonth[key].count++;
          const qR = q as unknown as Record<string,unknown>;
          byMonth[key].value += (qR.totalAmount as number|undefined)??(qR.total as number|undefined)??0;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const maxVal = Math.max(...months.map(m=>byMonth[m].value),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Quotation Volume & Value by Month</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {months.map(m=>(
                <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm" style={{height:`${(byMonth[m].value/maxVal)*56}px`,background:'#3b82f6',minHeight:byMonth[m].value>0?2:0}} />
                  <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Total: {quotations.length} quotes</span>
              <span>Avg: {quotations.length>0?(quotations.length/months.length).toFixed(0):0}/mo</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const custMonthOrders: Record<string,Record<string,number>> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!custMonthOrders[cid]) custMonthOrders[cid]={};
          custMonthOrders[cid][key]=(custMonthOrders[cid][key]??0)+1;
        });
        const topCusts = Object.entries(custMonthOrders).sort((a,b)=>Object.values(b[1]).reduce((x,y)=>x+y,0)-Object.values(a[1]).reduce((x,y)=>x+y,0)).slice(0,5);
        const allMonths = [...new Set(orders.map(o=>{const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;if(!d)return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}).filter(Boolean))].sort().slice(-5);
        if (topCusts.length < 2 || allMonths.length < 2) return null;
        const maxOrders = Math.max(...topCusts.flatMap(([,m])=>Object.values(m)),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Customer Order Frequency</h3>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left text-gray-400 font-normal pb-1 pr-2 w-24">Customer</th>
                  {allMonths.map(m=><th key={m} className="text-gray-400 font-normal pb-1 px-0.5">{m.slice(5)}</th>)}
                </tr>
              </thead>
              <tbody>
                {topCusts.map(([cid,monthMap])=>(
                  <tr key={cid}>
                    <td className="text-gray-600 truncate pr-2 py-0.5 max-w-[6rem]">{cid}</td>
                    {allMonths.map(m=>{
                      const n=monthMap[m]??0;
                      const intensity=n/maxOrders;
                      return <td key={m} className="px-0.5 py-0.5"><div className="rounded h-5 w-full flex items-center justify-center text-[9px] font-medium" style={{background:n>0?`rgba(255,64,0,${0.15+intensity*0.85})`:'#f3f4f6',color:intensity>0.5?'white':'#374151'}}>{n>0?n:''}</div></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const byMonth: Record<string,{qty:number;lines:number;orders:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key]={qty:0,lines:0,orders:0};
          byMonth[key].orders++;
          (o.lineItems??[]).forEach(li=>{ const lr=li as unknown as Record<string,unknown>; byMonth[key].qty+=((lr.quantity as number|undefined)??1); byMonth[key].lines++; });
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m=>({month:m.slice(5),avgQty:byMonth[m].orders>0?byMonth[m].qty/byMonth[m].orders:0,avgLines:byMonth[m].orders>0?byMonth[m].lines/byMonth[m].orders:0}));
        const maxVal = Math.max(...rows.map(r=>r.avgQty),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Avg Items per Order</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r=>(
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.avgQty.toFixed(1)}</span>
                  <div className="w-full rounded-sm" style={{height:`${(r.avgQty/maxVal)*56}px`,background:'#f59e0b',minHeight:r.avgQty>0?2:0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custLTV: Record<string,{revenue:number;orders:number;firstOrder:Date|null;lastOrder:Date|null}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          if (!custLTV[cid]) custLTV[cid]={revenue:0,orders:0,firstOrder:null,lastOrder:null};
          custLTV[cid].revenue+=total;
          custLTV[cid].orders++;
          if (d) { if (!custLTV[cid].firstOrder||d<custLTV[cid].firstOrder!) custLTV[cid].firstOrder=d; if (!custLTV[cid].lastOrder||d>custLTV[cid].lastOrder!) custLTV[cid].lastOrder=d; }
        });
        const top10 = Object.entries(custLTV).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,8);
        if (top10.length<2) return null;
        const maxRev = top10[0][1].revenue;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Customers by Lifetime Value</h3>
            <div className="space-y-2">
              {top10.map(([name,d],i)=>(
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(d.revenue/maxRev)*100}%`,background:i===0?'#ff4000':i<=2?'#f59e0b':'#6366f1'}} />
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-12 text-right">{fmtAna(d.revenue,'K',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const pairs: Record<string,number> = {};
        orders.forEach(o => {
          const names = (o.lineItems??[]).map(li=>{ const lr=li as unknown as Record<string,unknown>; return (lr.productName as string|undefined)??(lr.name as string|undefined)??''; }).filter(Boolean);
          if (names.length<2) return;
          for (let i=0;i<names.length;i++) for (let j=i+1;j<names.length;j++) {
            const key = [names[i],names[j]].sort().join(' + ');
            pairs[key]=(pairs[key]??0)+1;
          }
        });
        const topPairs = Object.entries(pairs).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (topPairs.length===0) return null;
        const maxCount = topPairs[0][1];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Frequently Co-Ordered Products</h3>
            <div className="space-y-2">
              {topPairs.map(([pair,count])=>(
                <div key={pair} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{pair}</span>
                  <div className="w-12 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(count/maxCount)*100}%`,background:'#8b5cf6'}} />
                  </div>
                  <span className="text-xs font-bold text-purple-600 w-4 text-right">{count}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        let grossRev=0, cancelledRev=0;
        const byMonth: Record<string,{gross:number;net:number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          grossRev+=total;
          if (o.status==='Cancelled') cancelledRev+=total;
          if (d) {
            const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (!byMonth[key]) byMonth[key]={gross:0,net:0};
            byMonth[key].gross+=total;
            if (o.status!=='Cancelled') byMonth[key].net+=total;
          }
        });
        const netRev = grossRev-cancelledRev;
        const months = Object.keys(byMonth).sort().slice(-5);
        if (months.length<2) return null;
        const maxNet = Math.max(...months.map(m=>byMonth[m].net),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-2">Net Revenue (excl. cancelled)</h3>
            <div className="flex items-center justify-between mb-3">
              <div><p className="text-2xl font-bold text-brand">{fmtAna(netRev,'K',1)}</p><p className="text-[10px] text-gray-400">net all-time</p></div>
              {cancelledRev>0&&<div className="text-right"><p className="text-sm font-bold text-red-500">-{fmtAna(cancelledRev,'K',1)}</p><p className="text-[10px] text-gray-400">from cancellations</p></div>}
            </div>
            <div className="flex items-end gap-2 h-16">
              {months.map(m=><div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full rounded-sm" style={{height:`${(byMonth[m].net/maxNet)*48}px`,background:'#22c55e',minHeight:byMonth[m].net>0?2:0}}/>
                <span className="text-[9px] text-gray-400">{m.slice(5)}</span>
              </div>)}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 10 && (() => {
        const dayCount: Record<string,number> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = d.toISOString().slice(0,10);
          dayCount[key]=(dayCount[key]??0)+1;
        });
        const days = Object.keys(dayCount).sort().slice(-35);
        if (days.length<7) return null;
        const maxCount = Math.max(...days.map(d=>dayCount[d]),1);
        // 7 columns (Mon-Sun), up to 5 rows
        const firstDow = (new Date(days[0]).getDay()+6)%7;
        const grid: {day:string;count:number}[][] = [];
        let week: {day:string;count:number}[] = Array.from({length:firstDow},()=>({day:'',count:0}));
        days.forEach(d=>{
          week.push({day:d,count:dayCount[d]});
          if (week.length===7) { grid.push(week); week=[]; }
        });
        if (week.length>0) { while(week.length<7) week.push({day:'',count:0}); grid.push(week); }
        const dowLabels=['M','T','W','T','F','S','S'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Order Activity Calendar</h3>
            <div className="flex gap-0.5 mb-1">{dowLabels.map((l,i)=><span key={i} className="flex-1 text-center text-[9px] text-gray-400">{l}</span>)}</div>
            <div className="space-y-0.5">
              {grid.map((week,wi)=>(
                <div key={wi} className="flex gap-0.5">
                  {week.map((cell,di)=>(
                    <div key={di} className="flex-1 aspect-square rounded-sm" style={{background:cell.count>0?`rgba(255,64,0,${0.1+(cell.count/maxCount)*0.9})`:'#f3f4f6'}} title={cell.day?`${cell.day}: ${cell.count} orders`:''} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 5 && (() => {
        const custFirstMonth: Record<string,string> = {};
        [...orders].sort((a,b)=>{
          const da=a.createdAt?((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)):new Date(0);
          const db=b.createdAt?((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)):new Date(0);
          return da.getTime()-db.getTime();
        }).forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
          if(!d) return;
          const cid=(o as unknown as Record<string,unknown>).customerId as string|undefined||(o as unknown as Record<string,unknown>).customerName as string|undefined||'Unknown';
          const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if(!custFirstMonth[cid]) custFirstMonth[cid]=key;
        });
        const newByMonth: Record<string,number>={};
        Object.values(custFirstMonth).forEach(m=>{ newByMonth[m]=(newByMonth[m]??0)+1; });
        const months=Object.keys(newByMonth).sort().slice(-8);
        if(months.length<3) return null;
        const vals=months.map(m=>newByMonth[m]);
        const maxV=Math.max(...vals,1);
        const totalNew=vals.reduce((a,b)=>a+b,0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">New Customer Acquisition</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{totalNew} total</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {vals.map((v,i)=>(
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{v}</span>
                  <div className="w-full rounded-sm" style={{height:`${(v/maxV)*56}px`,background:'#22c55e',minHeight:v>0?2:0}}/>
                  <span className="text-[9px] text-gray-400">{months[i]?.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 2 && inventory.length >= 3 && (() => {
        const quotedProductNames = new Set<string>();
        quotations.forEach(q=>{ (q as unknown as Record<string,unknown>); const items=((q as unknown as Record<string,unknown>).items as {productName?:string;name?:string}[]|undefined)??[]; items.forEach(i=>{ const n=i.productName??i.name; if(n) quotedProductNames.add(n); }); });
        const neverQuoted=inventory.filter(item=>!quotedProductNames.has(item.name)&&((item.stock as number|undefined)??0)>0).slice(0,6);
        if(neverQuoted.length===0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>💤 Products Never Quoted</span>
              <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{neverQuoted.length} shown</span>
            </h3>
            <div className="space-y-1.5">
              {neverQuoted.map((item,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 ml-2">×{(item.stock as number|undefined)??0}</span>
                  <span className="text-gray-500 ml-2">{(item.prices?.['Retail'] as number|undefined) != null ? fmtAna((item.prices?.['Retail'] as number)) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && orders.length >= 8 && (() => {
        const now=new Date();
        const custLastOrder: Record<string,Date>={};
        const custOrders: Record<string,{date:Date;gap:number}[]>={};
        [...orders].sort((a,b)=>{ const da=a.createdAt?((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)):new Date(0); const db=b.createdAt?((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)):new Date(0); return da.getTime()-db.getTime(); }).forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; if(!d) return;
          const cid=(o as unknown as Record<string,unknown>).customerName as string|undefined||(o as unknown as Record<string,unknown>).customerId as string|undefined||'Unknown';
          const prev=custLastOrder[cid];
          const gap=prev?Math.floor((d.getTime()-prev.getTime())/86400000):0;
          if(!custOrders[cid]) custOrders[cid]=[];
          if(prev&&gap>=60) custOrders[cid].push({date:d,gap});
          custLastOrder[cid]=d;
        });
        const reEngaged=Object.entries(custOrders).filter(([,arr])=>arr.length>0&&arr[arr.length-1].date>new Date(now.getTime()-90*86400000)).length;
        const totalReEngagements=Object.values(custOrders).reduce((s,arr)=>s+arr.length,0);
        if(totalReEngagements===0) return null;
        const avgGap=totalReEngagements>0?Math.round(Object.values(custOrders).flatMap(a=>a.map(e=>e.gap)).reduce((a,b)=>a+b,0)/totalReEngagements):0;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Customer Re-Engagement</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[{label:'Total Re-engaged',val:String(totalReEngagements),color:'#22c55e'},{label:'Recent (90d)',val:String(reEngaged),color:'#3b82f6'},{label:'Avg Gap',val:`${avgGap}d`,color:'#f59e0b'}].map(s=>(
                <div key={s.label} className="rounded-xl p-3" style={{background:`${s.color}12`}}>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'crm' && quotations.length >= 3 && (() => {
        const statusMap: Record<string,number>={};
        quotations.forEach(q=>{ const s=((q as unknown as Record<string,unknown>).status as string|undefined)??'Unknown'; statusMap[s]=(statusMap[s]??0)+1; });
        const approved=(statusMap['Approved']??0)+(statusMap['Accepted']??0)+(statusMap['Won']??0);
        const rejected=(statusMap['Rejected']??0)+(statusMap['Declined']??0)+(statusMap['Lost']??0);
        const converted=(statusMap['Converted']??0)+(statusMap['Ordered']??0);
        const total=quotations.length;
        const approvalRate=total>0?Math.round(((approved+converted)/total)*100):0;
        const segments=[{label:'Approved/Won',count:approved+converted,color:'#22c55e'},{label:'Pending',count:total-approved-converted-rejected,color:'#f59e0b'},{label:'Rejected',count:rejected,color:'#ef4444'}].filter(s=>s.count>0);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">Quotation Approval Rate</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{approvalRate}%</span>
            </div>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {segments.map(s=>s.count>0&&<div key={s.label} style={{width:`${(s.count/total)*100}%`,background:s.color}} title={`${s.label}: ${s.count}`}/>)}
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              {segments.map(s=>(
                <div key={s.label}>
                  <p className="text-lg font-bold" style={{color:s.color}}>{s.count}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
