/**
 * LojistikRapor.tsx — Raporlar > Lojistik sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'lojistik' sekmesine ait 51 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'lojistik'` koşulları BİLEREK korundu: ebeveyn zaten
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
import { itemCostTRY, itemPriceTRY, type ReportsCtx } from './useReportsData';
import { KpiCard, KpiGrid } from './ReportKit';

export default function LojistikRapor(ctx: ReportsCtx) {
  const { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, salesByDate, trendData, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF } = ctx;
  void itemCostTRY; void itemPriceTRY; // sekmeye göre kullanılıyor olabilir
  return (
    <>
      {reportsTab === 'lojistik' && (
        <div className="space-y-6">
          {/* KPIs — ortak KpiCard/KpiGrid (ReportKit) ile tek tip.
              4. kart eskiden "Toplam Ciro" idi: ciro bir SATIŞ göstergesi, lojistik
              raporunda konu dışıydı (kullanıcı: "rapor çekerken gelen veriler o
              konuyla ilgili olmalı"). Yerine sevkiyat bekleyen sipariş sayısı. */}
          <KpiGrid>
            {([
              { label: currentLanguage==='tr'?'Toplam Sipariş':'Total Orders', value: String(totalOrders), icon: Package, accent: 'text-brand', accentBg: 'bg-brand/10' },
              { label: currentLanguage==='tr'?'Teslim Edilen':'Delivered', value: String(orders.filter(o=>o.status==='Delivered').length), icon: CheckCircle2, accent: 'text-green-600', accentBg: 'bg-green-50' },
              { label: currentLanguage==='tr'?'Yolda':'In Transit', value: String(orders.filter(o=>o.status==='Shipped').length), icon: Truck, accent: 'text-blue-600', accentBg: 'bg-blue-50' },
              { label: currentLanguage==='tr'?'Sevkiyat Bekleyen':'Awaiting Shipment', value: String(orders.filter(o=>o.status==='Pending'||o.status==='Processing').length), icon: Calendar, accent: 'text-orange-500', accentBg: 'bg-orange-50' },
            ] as { label: string; value: string; icon: React.ElementType; accent: string; accentBg: string }[]).map((k,i) => (
              <KpiCard key={i} index={i} label={k.label} value={k.value} icon={k.icon} accent={k.accent} accentBg={k.accentBg} />
            ))}
          </KpiGrid>

          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Teslimat Performansı':'Delivery Performance'}</h3>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={statusChartData} cx="50%" cy="50%" outerRadius={100} paddingAngle={4} dataKey="value" label={(props: { name?: string, value?: number }) => `${props.name || ''}: ${props.value || 0}`}>
                    {statusChartData.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Son Siparişler — Lojistik Durumu':'Recent Orders — Logistics Status'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {[
                      {k:'shopifyOrderId', label:currentLanguage==='tr'?'Sipariş':'Order', align:'text-left', cls:''},
                      {k:'customerName', label:currentLanguage==='tr'?'Müşteri':'Customer', align:'text-left', cls:'hidden sm:table-cell'},
                      {k:'shippingAddress', label:currentLanguage==='tr'?'Adres':'Address', align:'text-left', cls:'hidden md:table-cell'},
                      {k:'status', label:currentLanguage==='tr'?'Durum':'Status', align:'text-center', cls:''},
                    ].map(({k,label,align,cls}) => {
                      const active = logisticsSummarySort.key === k;
                      return (
                        <th key={k} onClick={() => setLogisticsSummarySort(s=>({key:k,dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} className={`${align} py-2 px-3 font-medium text-xs cursor-pointer select-none transition-colors ${cls} ${active?'text-brand':'text-gray-500 hover:text-gray-700'}`}>
                          {label} <span className={active?'opacity-100':'opacity-25'}>{active?(logisticsSummarySort.dir==='asc'?'↑':'↓'):'↕'}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {[...orders].sort((a,b) => {
                    const av = (a as unknown as Record<string,unknown>)[logisticsSummarySort.key] as string|number ?? '';
                    const bv = (b as unknown as Record<string,unknown>)[logisticsSummarySort.key] as string|number ?? '';
                    if (av < bv) return logisticsSummarySort.dir === 'asc' ? -1 : 1;
                    if (av > bv) return logisticsSummarySort.dir === 'asc' ? 1 : -1;
                    return 0;
                  }).slice(0,8).map((o,i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-600">#{o.shopifyOrderId||o.id?.slice(-6)||'—'}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800 hidden sm:table-cell">{o.customerName||'—'}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-400 truncate max-w-[150px] hidden md:table-cell">{o.shippingAddress||'—'}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status==='Delivered'?'bg-green-100 text-green-600':o.status==='Shipped'?'bg-blue-100 text-blue-600':o.status==='Pending'?'bg-yellow-100 text-yellow-600':'bg-gray-100 text-gray-500'}`}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Phase 140: Cargo Company Performance Analysis ── */}
          {orders.filter(o => o.cargoCompany).length > 0 && (() => {
            type CargoStat = { name: string; shipments: number; delivered: number; deliveryRate: number; avgRevenue: number };
            const cargoMap: Record<string, CargoStat> = {};
            for (const o of orders) {
              if (!o.cargoCompany) continue;
              const co = o.cargoCompany;
              if (!cargoMap[co]) cargoMap[co] = { name: co, shipments: 0, delivered: 0, deliveryRate: 0, avgRevenue: 0 };
              cargoMap[co].shipments++;
              cargoMap[co].avgRevenue += o.totalPrice || 0;
              if (o.status === 'Delivered') cargoMap[co].delivered++;
            }
            const cargos = Object.values(cargoMap).map(c => ({
              ...c,
              deliveryRate: c.shipments > 0 ? Math.round((c.delivered / c.shipments) * 100) : 0,
              avgRevenue: c.shipments > 0 ? c.avgRevenue / c.shipments : 0,
            })).sort((a, b) => b.deliveryRate - a.deliveryRate);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🚚 Kargo Firması Performansı' : '🚚 Cargo Company Performance'}</h3>
                <div className="space-y-3">
                  {cargos.map(c => (
                    <div key={c.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-gray-800">{c.name}</p>
                          <span className="text-[9px] text-gray-400">{c.shipments} {currentLanguage === 'tr' ? 'gönderi' : 'shipments'}</span>
                        </div>
                        <span className={`text-xs font-bold ${c.deliveryRate >= 80 ? 'text-emerald-600' : c.deliveryRate >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                          %{c.deliveryRate} {currentLanguage === 'tr' ? 'teslimat' : 'delivery'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className={`h-2 rounded-full transition-all duration-700 ${c.deliveryRate >= 80 ? 'bg-emerald-400' : c.deliveryRate >= 60 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${c.deliveryRate}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 152: Order Fulfillment Rate by City ── */}
          {orders.some(o => o.shippingAddress) && (() => {
            type CityFulfill = { city: string; total: number; delivered: number; rate: number };
            const cityMap: Record<string, CityFulfill> = {};
            for (const o of orders) {
              if (!o.shippingAddress) continue;
              // Extract city from address (last meaningful token or full address if short)
              const parts = o.shippingAddress.split(/[,\/\n]/);
              const city = (parts[parts.length - 1] || parts[0] || '—').trim().slice(0, 20) || '—';
              if (!cityMap[city]) cityMap[city] = { city, total: 0, delivered: 0, rate: 0 };
              cityMap[city].total++;
              if (o.status === 'Delivered') cityMap[city].delivered++;
            }
            const cities = Object.values(cityMap)
              .map(c => ({ ...c, rate: c.total > 0 ? Math.round((c.delivered / c.total) * 100) : 0 }))
              .filter(c => c.total >= 2)
              .sort((a, b) => b.total - a.total)
              .slice(0, 10);
            if (cities.length === 0) return null;
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🗺️ Şehir Bazında Teslimat Oranı' : '🗺️ Fulfillment Rate by City'}</h3>
                <div className="space-y-2.5">
                  {cities.map(c => (
                    <div key={c.city} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 font-medium w-28 shrink-0 truncate">{c.city}</span>
                      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${c.rate >= 80 ? 'bg-emerald-400' : c.rate >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${c.rate}%` }} />
                      </div>
                      <span className={`text-xs font-bold w-12 text-right shrink-0 tabular-nums ${c.rate >= 80 ? 'text-emerald-600' : c.rate >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                        %{c.rate}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0">{c.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 170: Order Lead Time Analysis ── */}
          {orders.filter(o => o.status === 'Delivered').length >= 3 && (() => {
            const delivered = orders.filter(o => o.status === 'Delivered' && o.createdAt);
            const leadTimes: number[] = [];
            for (const o of delivered) {
              try {
                const created = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
                // Approximate delivery date as updatedAt or +7 days heuristic
                const raw2 = (o as unknown as Record<string,unknown>).updatedAt;
                const delivered_date = raw2
                  ? ((raw2 as { toDate?: () => Date }).toDate?.() ?? new Date(raw2 as string))
                  : null;
                if (delivered_date) {
                  const days = Math.round((delivered_date.getTime() - created.getTime()) / 86400000);
                  if (days >= 0 && days <= 90) leadTimes.push(days);
                }
              } catch { /* skip */ }
            }
            if (leadTimes.length < 2) return null;
            const avgLT = Math.round(leadTimes.reduce((s, d) => s + d, 0) / leadTimes.length);
            const minLT = Math.min(...leadTimes);
            const maxLT = Math.max(...leadTimes);
            // Histogram buckets
            const buckets = [
              { label: '0-3', min: 0, max: 3, count: 0 },
              { label: '4-7', min: 4, max: 7, count: 0 },
              { label: '8-14', min: 8, max: 14, count: 0 },
              { label: '15+', min: 15, max: Infinity, count: 0 },
            ];
            for (const d of leadTimes) { const b = buckets.find(b => d >= b.min && d <= b.max); if (b) b.count++; }
            const maxBucketCount = Math.max(...buckets.map(b => b.count), 1);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📦 Sipariş Teslim Süresi' : '📦 Order Lead Time'}</h3>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: currentLanguage==='tr'?'Ortalama':'Average', value: `${avgLT}g`, color: avgLT <= 7 ? 'text-emerald-600' : avgLT <= 14 ? 'text-amber-600' : 'text-red-500' },
                    { label: currentLanguage==='tr'?'En Hızlı':'Fastest', value: `${minLT}g`, color: 'text-emerald-600' },
                    { label: currentLanguage==='tr'?'En Yavaş':'Slowest', value: `${maxLT}g`, color: 'text-red-500' },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                      <p className="text-[10px] text-gray-400">{k.label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-end gap-3 h-20">
                  {buckets.map(b => (
                    <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex flex-col justify-end" style={{ height: '64px' }}>
                        <div className={`w-full rounded-t-lg ${b.label === '0-3' ? 'bg-emerald-400' : b.label === '4-7' ? 'bg-blue-400' : b.label === '8-14' ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ height: `${Math.max(Math.round((b.count / maxBucketCount) * 100), 4)}%` }} />
                      </div>
                      <span className="text-[9px] text-gray-400">{b.label}{currentLanguage==='tr'?'g':'d'}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">{currentLanguage==='tr'?`${leadTimes.length} teslim üzerinden hesaplandı`:`Calculated from ${leadTimes.length} deliveries`}</p>
              </div>
            );
          })()}
        </div>
      )}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now195 = new Date();
        const last90 = new Date(now195); last90.setDate(last90.getDate() - 90);
        const recent = orders.filter(o => {
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            return od >= last90;
          } catch { return false; }
        });
        const totalOrders195 = recent.length;
        const delivered = recent.filter(o => o.status === 'Delivered').length;
        const cancelled = recent.filter(o => o.status === 'Cancelled').length;
        const inProgress = recent.filter(o => o.status === 'Processing' || o.status === 'Shipped').length;
        const pending = recent.filter(o => o.status === 'Pending').length;
        const fulfillRate = totalOrders195 > 0 ? Math.round((delivered / totalOrders195) * 100) : 0;
        const cancelRate195 = totalOrders195 > 0 ? Math.round((cancelled / totalOrders195) * 100) : 0;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '✅ Sipariş Karşılama Oranı (Son 90 Gün)' : '✅ Order Fulfillment Rate (Last 90 Days)'}</h3>
              <span className={`text-lg font-black ${fulfillRate >= 80 ? 'text-emerald-600' : fulfillRate >= 60 ? 'text-amber-500' : 'text-red-500'}`}>%{fulfillRate}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Toplam' : 'Total', value: totalOrders195, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? 'Teslim' : 'Delivered', value: delivered, color: 'text-emerald-600' },
                { label: currentLanguage === 'tr' ? 'Süreçte' : 'In Progress', value: inProgress + pending, color: 'text-blue-600' },
                { label: currentLanguage === 'tr' ? 'İptal' : 'Cancelled', value: cancelled, color: 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-0.5">
              <div className="h-full bg-emerald-400 rounded-l-full" style={{ width: `${Math.round((delivered / Math.max(totalOrders195, 1)) * 100)}%` }} />
              <div className="h-full bg-blue-300" style={{ width: `${Math.round(((inProgress + pending) / Math.max(totalOrders195, 1)) * 100)}%` }} />
              <div className="h-full bg-red-300 rounded-r-full" style={{ width: `${Math.round((cancelled / Math.max(totalOrders195, 1)) * 100)}%` }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? `İptal oranı: %${cancelRate195}` : `Cancel rate: ${cancelRate195}%`}</p>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.filter(o => o.status === 'Cancelled').length >= 2 && (() => {
        const cancelled209 = orders.filter(o => o.status === 'Cancelled');
        // Group by cancellation reason field or customer
        const reasonMap: Record<string, number> = {};
        const custMap: Record<string, number> = {};
        for (const o of cancelled209) {
          const m = o as unknown as Record<string,unknown>;
          const reason = (m.cancelReason as string) || (m.cancellationReason as string) || (currentLanguage === 'tr' ? 'Belirtilmemiş' : 'Not specified');
          reasonMap[reason] = (reasonMap[reason] ?? 0) + 1;
          const cust = o.customerName || '—';
          custMap[cust] = (custMap[cust] ?? 0) + 1;
        }
        const reasons = Object.entries(reasonMap).sort(([,a],[,b]) => b - a).slice(0, 5);
        const topCancellers = Object.entries(custMap).sort(([,a],[,b]) => b - a).slice(0, 4);
        const total209 = cancelled209.length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔍 İptal Kök Neden Analizi' : '🔍 Cancellation Root Cause'}</h3>
              <span className="text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">{total209} {currentLanguage === 'tr' ? 'iptal' : 'cancellations'}</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold text-gray-500 mb-2 uppercase tracking-wide">{currentLanguage === 'tr' ? 'İptal Sebebi' : 'Cancellation Reason'}</p>
                <div className="space-y-2">
                  {reasons.map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{reason}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.round((count / total209) * 100)}%` }} />
                        </div>
                        <span className="font-bold text-gray-700 w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-gray-500 mb-2 uppercase tracking-wide">{currentLanguage === 'tr' ? 'En Çok İptal Eden' : 'Most Cancellations By'}</p>
                <div className="space-y-2">
                  {topCancellers.map(([cust, count]) => (
                    <div key={cust} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{cust}</span>
                      <span className="font-bold text-red-500 shrink-0 ml-2">{count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const total212 = orders.length;
        const stages212 = [
          { label: currentLanguage === 'tr' ? 'Toplam Sipariş' : 'Total Orders', count: total212, color: 'bg-gray-400' },
          { label: currentLanguage === 'tr' ? 'İşleniyor/Bekliyor' : 'Processing/Pending', count: orders.filter(o => o.status === 'Pending' || o.status === 'Processing').length, color: 'bg-blue-400' },
          { label: currentLanguage === 'tr' ? 'Kargoya Verildi' : 'Shipped', count: orders.filter(o => o.status === 'Shipped').length, color: 'bg-amber-400' },
          { label: currentLanguage === 'tr' ? 'Teslim Edildi' : 'Delivered', count: orders.filter(o => o.status === 'Delivered').length, color: 'bg-emerald-400' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🔽 Sipariş Durum Hunisi' : '🔽 Order Status Funnel'}</h3>
            <div className="space-y-2">
              {stages212.map((s, i) => {
                const pct = total212 > 0 ? Math.round((s.count / total212) * 100) : 0;
                const width = Math.max(10, 100 - i * 12);
                return (
                  <div key={s.label} className="flex flex-col items-center">
                    <div className={`h-10 ${s.color} rounded-xl flex items-center justify-between px-4 text-white`} style={{ width: `${width}%` }}>
                      <span className="text-xs font-medium">{s.label}</span>
                      <span className="text-sm font-bold">{s.count} <span className="text-xs font-normal opacity-80">(%{pct})</span></span>
                    </div>
                    {i < stages212.length - 1 && (
                      <div className="w-px h-3 bg-gray-200 my-0.5" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 p-3 bg-red-50 rounded-xl flex items-center justify-between">
              <span className="text-xs text-red-700 font-medium">❌ {currentLanguage === 'tr' ? 'İptal' : 'Cancelled'}</span>
              <span className="text-sm font-bold text-red-600">{orders.filter(o => o.status === 'Cancelled').length} ({total212 > 0 ? Math.round((orders.filter(o => o.status === 'Cancelled').length / total212) * 100) : 0}%)</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const regionRev: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const m = o as unknown as Record<string,unknown>;
          const city = (m.deliveryCity as string) || (m.city as string) || (m.region as string) || '';
          if (!city) continue;
          regionRev[city] = (regionRev[city] ?? 0) + (o.totalPrice || 0);
        }
        const regions = Object.entries(regionRev).sort(([,a],[,b]) => b - a).slice(0, 8);
        if (regions.length < 2) return null;
        const totalRegRev = regions.reduce((s,[,v]) => s + v, 0);
        const maxRegRev = regions[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🗺️ Bölgeye Göre Ciro' : '🗺️ Revenue by Region'}</h3>
            <div className="space-y-2.5">
              {regions.map(([region, rev]) => {
                const pct = totalRegRev > 0 ? Math.round((rev / totalRegRev) * 100) : 0;
                return (
                  <div key={region}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700">{region}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.max(4, Math.round((rev / maxRegRev) * 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const shippingOrders = orders.filter(o => {
          const m = o as unknown as Record<string,unknown>;
          return (m.shippingCost as number) > 0 || (m.deliveryCost as number) > 0;
        });
        if (shippingOrders.length < 3) return null;
        const totalShipping = shippingOrders.reduce((s, o) => {
          const m = o as unknown as Record<string,unknown>;
          return s + (((m.shippingCost as number) || 0) + ((m.deliveryCost as number) || 0));
        }, 0);
        const totalRevShip = shippingOrders.reduce((s, o) => s + (o.totalPrice || 0), 0);
        const shippingRatio = totalRevShip > 0 ? Math.round((totalShipping / totalRevShip) * 100) : 0;
        const avgShippingPerOrder = Math.round(totalShipping / shippingOrders.length);
        // By status
        const byStatus: Record<string, number> = {};
        for (const o of shippingOrders) {
          const m = o as unknown as Record<string,unknown>;
          const cost = ((m.shippingCost as number) || 0) + ((m.deliveryCost as number) || 0);
          byStatus[o.status] = (byStatus[o.status] ?? 0) + cost;
        }
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🚛 Nakliye Maliyeti Analizi' : '🚛 Shipping Cost Analysis'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">%{shippingRatio} {currentLanguage === 'tr' ? 'ciro oranı' : 'of revenue'}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Toplam Nakliye' : 'Total Shipping', value: `₺${(totalShipping/1000).toFixed(0)}K`, color: 'text-blue-600' },
                { label: currentLanguage === 'tr' ? 'Sipariş Başı' : 'Per Order', value: `₺${avgShippingPerOrder.toLocaleString()}`, color: 'text-gray-700' },
                { label: currentLanguage === 'tr' ? 'Sipariş Sayısı' : 'Orders Tracked', value: String(shippingOrders.length), color: 'text-gray-500' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(shippingRatio * 3, 100)}%` }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{currentLanguage === 'tr' ? 'Benchmark: %3-7 (e-ticaret sektörü)' : 'Benchmark: 3-7% (e-commerce industry)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now229 = new Date();
        // Avg days from Pending → each subsequent status
        const openOrders = orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled');
        const ageBuckets: Record<string, { total: number; count: number }> = {
          Pending: { total: 0, count: 0 },
          Processing: { total: 0, count: 0 },
          Shipped: { total: 0, count: 0 },
        };
        for (const o of openOrders) {
          if (!ageBuckets[o.status]) continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            const days = Math.round((now229.getTime() - od.getTime()) / 86400000);
            ageBuckets[o.status].total += days;
            ageBuckets[o.status].count++;
          } catch { /* skip */ }
        }
        const statusInfo: Record<string, { label: string; color: string; warn: number }> = {
          Pending: { label: currentLanguage === 'tr' ? 'Beklemede' : 'Pending', color: 'bg-gray-400', warn: 3 },
          Processing: { label: currentLanguage === 'tr' ? 'İşleniyor' : 'Processing', color: 'bg-blue-400', warn: 5 },
          Shipped: { label: currentLanguage === 'tr' ? 'Kargoda' : 'Shipped', color: 'bg-amber-400', warn: 7 },
        };
        const hasData = Object.values(ageBuckets).some(b => b.count > 0);
        if (!hasData) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📊 Statüye Göre Bekleyen Sipariş Yaşı' : '📊 Open Order Age by Status'}</h3>
              <span className="text-xs text-gray-400">{openOrders.length} {currentLanguage === 'tr' ? 'açık sipariş' : 'open orders'}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(ageBuckets).map(([status, d]) => {
                const avg = d.count > 0 ? Math.round(d.total / d.count) : 0;
                const info = statusInfo[status];
                const isWarn = avg > info.warn;
                return (
                  <div key={status} className={`rounded-xl p-4 ${isWarn ? 'bg-red-50 border border-red-100' : 'bg-gray-50'}`}>
                    <div className={`w-2 h-2 rounded-full ${info.color} mb-2`} />
                    <p className={`text-2xl font-black ${isWarn ? 'text-red-600' : 'text-gray-700'}`}>{d.count > 0 ? avg : '—'}{d.count > 0 ? (currentLanguage === 'tr' ? 'g' : 'd') : ''}</p>
                    <p className="text-[10px] text-gray-600 font-medium mt-0.5">{info.label}</p>
                    <p className="text-[9px] text-gray-400">{d.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'}</p>
                    {isWarn && <p className="text-[9px] text-red-500 font-bold mt-1">{'⚠ >'}{info.warn}{currentLanguage === 'tr' ? 'g' : 'd'}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        // Orders with deliveredAt vs expectedDelivery or estimatedDelivery
        const deliveredOrders = orders.filter(o => {
          const m = o as unknown as Record<string,unknown>;
          return o.status === 'Delivered' && (m.deliveredAt || m.updatedAt) && (m.expectedDelivery || m.estimatedDelivery || m.promisedDate);
        });
        if (deliveredOrders.length < 2) {
          // Show basic delivered vs total breakdown instead
          const total243 = orders.length;
          const delivered243 = orders.filter(o => o.status === 'Delivered').length;
          const inTransit243 = orders.filter(o => o.status === 'Shipped').length;
          const pending243 = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').length;
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🚚 Lojistik Performans Özeti' : '🚚 Logistics Performance Summary'}</h3>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: currentLanguage === 'tr' ? 'Toplam' : 'Total', value: total243, color: 'text-gray-700' },
                  { label: currentLanguage === 'tr' ? 'Teslim' : 'Delivered', value: delivered243, color: 'text-emerald-600' },
                  { label: currentLanguage === 'tr' ? 'Kargoda' : 'In Transit', value: inTransit243, color: 'text-blue-600' },
                  { label: currentLanguage === 'tr' ? 'Bekleyen' : 'Pending', value: pending243, color: 'text-amber-600' },
                ].map(k => (
                  <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-600 mb-2">{currentLanguage === 'tr' ? 'Teslim Performansı' : 'Delivery Performance'}</p>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-px">
                  <div className="h-full bg-emerald-400" style={{ width: `${total243 > 0 ? Math.round((delivered243/total243)*100) : 0}%` }} />
                  <div className="h-full bg-blue-300" style={{ width: `${total243 > 0 ? Math.round((inTransit243/total243)*100) : 0}%` }} />
                  <div className="h-full bg-amber-300" style={{ width: `${total243 > 0 ? Math.round((pending243/total243)*100) : 0}%` }} />
                </div>
              </div>
            </div>
          );
        }
        let onTime = 0;
        for (const o of deliveredOrders) {
          const m = o as unknown as Record<string,unknown>;
          try {
            const deliveredDate = ((m.deliveredAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.deliveredAt as string))
              || ((m.updatedAt as { toDate?: () => Date })?.toDate?.() ?? new Date(m.updatedAt as string));
            const expectedDate = ((m.expectedDelivery as { toDate?: () => Date })?.toDate?.() ?? new Date(m.expectedDelivery as string))
              || ((m.estimatedDelivery as { toDate?: () => Date })?.toDate?.() ?? new Date(m.estimatedDelivery as string));
            if (deliveredDate <= expectedDate) onTime++;
          } catch { /* skip */ }
        }
        const otdRate = deliveredOrders.length > 0 ? Math.round((onTime / deliveredOrders.length) * 100) : 0;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '✅ Zamanında Teslimat Oranı (OTD)' : '✅ On-Time Delivery Rate (OTD)'}</h3>
              <span className={`text-2xl font-black ${otdRate >= 90 ? 'text-emerald-600' : otdRate >= 75 ? 'text-amber-500' : 'text-red-500'}`}>%{otdRate}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-emerald-600">{onTime}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Zamanında' : 'On Time'}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-red-500">{deliveredOrders.length - onTime}</p>
                <p className="text-[10px] text-gray-500">{currentLanguage === 'tr' ? 'Gecikmeli' : 'Late'}</p>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Benchmark: %95+ (dünya standartı)' : 'Benchmark: 95%+ (world class OTD)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const total = orders.length;
        const delivered = orders.filter(o => o.status === 'Delivered').length;
        const cancelled = orders.filter(o => o.status === 'Cancelled').length;
        const pending = orders.filter(o => o.status === 'Pending').length;
        const inTransit = orders.filter(o => o.status === 'Shipped' || o.status === 'Processing').length;
        const deliveryRate = total > 0 ? (delivered / total * 100) : 0;
        const cancellationRate = total > 0 ? (cancelled / total * 100) : 0;
        const utilizationRate = total > 0 ? ((total - pending) / total * 100) : 0;
        const now = new Date();
        const avgAge = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').map(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000;
        });
        const avgOpenAge = avgAge.length > 0 ? avgAge.reduce((s,a)=>s+a,0) / avgAge.length : 0;
        const score = Math.round(deliveryRate * 0.4 + utilizationRate * 0.3 + Math.max(0, 100 - cancellationRate * 5) * 0.2 + Math.max(0, 100 - avgOpenAge * 2) * 0.1);
        const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
        const metrics = [
          { label: 'Delivery Rate', value: `${deliveryRate.toFixed(1)}%`, color: deliveryRate >= 80 ? '#10b981' : '#f59e0b' },
          { label: 'Cancellation Rate', value: `${cancellationRate.toFixed(1)}%`, color: cancellationRate <= 5 ? '#10b981' : '#ef4444' },
          { label: 'In Transit', value: inTransit.toString(), color: '#3b82f6' },
          { label: 'Pending', value: pending.toString(), color: pending > 10 ? '#ef4444' : '#6b7280' },
          { label: 'Avg Open Age', value: `${avgOpenAge.toFixed(1)}d`, color: avgOpenAge <= 3 ? '#10b981' : '#f59e0b' },
          { label: 'Fulfillment Rate', value: `${utilizationRate.toFixed(1)}%`, color: utilizationRate >= 90 ? '#10b981' : '#f59e0b' },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Lojistik Performans Puanı' : 'Logistics Performance Score'}</h3>
                <p className="text-xs text-gray-500">Composite score from delivery, cancellation & fulfillment KPIs</p>
              </div>
              <div className="text-center">
                <div className="text-4xl font-black" style={{ color: scoreColor }}>{score}</div>
                <div className="text-xs text-gray-400">/ 100</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {metrics.map((m,i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-lg font-bold" style={{ color: m.color }}>{m.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const aged = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').map(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const age = Math.floor((now.getTime() - d.getTime()) / 86400000);
          return { ...o, age };
        });
        const critical = aged.filter(o => o.age >= 7);
        const urgent = aged.filter(o => o.age >= 3 && o.age < 7);
        const normal = aged.filter(o => o.age < 3);
        const buckets = [
          { label: 'Critical (7+ days)', count: critical.length, revenue: critical.reduce((s,o)=>s+o.totalPrice,0), color: '#ef4444', bg: '#fef2f2' },
          { label: 'Urgent (3-6 days)', count: urgent.length, revenue: urgent.reduce((s,o)=>s+o.totalPrice,0), color: '#f59e0b', bg: '#fffbeb' },
          { label: 'Normal (0-2 days)', count: normal.length, revenue: normal.reduce((s,o)=>s+o.totalPrice,0), color: '#10b981', bg: '#f0fdf4' },
        ];
        if (aged.length === 0) {
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Açık Sipariş Öncelik Sırası' : 'Open Order Priority Queue'}</h3>
              <p className="text-xs text-green-600 text-center py-4">✅ No open orders pending fulfillment</p>
            </div>
          );
        }
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Açık Sipariş Öncelik Sırası' : 'Open Order Priority Queue'}</h3>
            <p className="text-xs text-gray-500 mb-4">Age-based prioritization of {aged.length} open orders</p>
            <div className="space-y-3">
              {buckets.map((b,i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: b.bg }}>
                  <div>
                    <span className="text-sm font-bold" style={{ color: b.color }}>{b.label}</span>
                    <span className="text-xs text-gray-500 ml-2">{b.count} orders</span>
                  </div>
                  <div className="text-sm font-bold text-gray-700">{fmtAna(b.revenue,'full',0)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const cargoMap: Record<string, {orders: number; revenue: number}> = {};
        orders.filter(o => o.cargoCompany).forEach(o => {
          const cargo = o.cargoCompany!;
          if (!cargoMap[cargo]) cargoMap[cargo] = { orders: 0, revenue: 0 };
          cargoMap[cargo].orders++;
          cargoMap[cargo].revenue += o.totalPrice;
        });
        const last30 = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        });
        const withCargo = last30.filter(o => o.cargoCompany).length;
        const withoutCargo = last30.filter(o => !o.cargoCompany).length;
        const cargoEntries = Object.entries(cargoMap).sort((a,b)=>b[1].revenue-a[1].revenue);
        if (cargoEntries.length === 0) return null;
        const totalRev = cargoEntries.reduce((s,[,d])=>s+d.revenue,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Kargo Firması Performansı' : 'Cargo Partner Performance'}</h3>
            <p className="text-xs text-gray-500 mb-3">Revenue and order distribution by shipping carrier</p>
            <div className="space-y-2 mb-4">
              {cargoEntries.slice(0,6).map(([cargo,d],i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 truncate font-medium">{cargo}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-cyan-500" style={{ width: `${totalRev>0?(d.revenue/totalRev*100):0}%` }} />
                  </div>
                  <span className="text-xs text-gray-500">{d.orders} orders</span>
                  <span className="text-xs font-bold text-cyan-700">{totalRev>0?((d.revenue/totalRev)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-center">
              <div className="bg-green-50 rounded-xl p-3">
                <div className="font-bold text-green-700">{withCargo}</div>
                <div className="text-gray-500">Orders with Cargo (30d)</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="font-bold text-gray-700">{withoutCargo}</div>
                <div className="text-gray-500">No Cargo Assigned</div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const delivered = orders.filter(o => o.status === 'Delivered' && o.createdAt).map(o => {
          const created = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const delivered = o.estimatedDelivery
            ? ((o.estimatedDelivery as {toDate?:()=>Date}).toDate?.() ?? new Date(o.estimatedDelivery as string))
            : null;
          if (!delivered) return null;
          const days = Math.floor((delivered.getTime() - created.getTime()) / 86400000);
          return days >= 0 && days <= 30 ? days : null;
        }).filter((d): d is number => d !== null);
        if (delivered.length < 3) return null;
        const buckets = [
          { label: 'Same day', range: [0,0], color: '#10b981' },
          { label: '1-2 days', range: [1,2], color: '#3b82f6' },
          { label: '3-5 days', range: [3,5], color: '#f59e0b' },
          { label: '6-10 days', range: [6,10], color: '#f97316' },
          { label: '11+ days', range: [11,999], color: '#ef4444' },
        ];
        const bucketData = buckets.map(b => ({
          ...b,
          count: delivered.filter(d => d >= b.range[0] && d <= b.range[1]).length,
        }));
        const maxCount = Math.max(...bucketData.map(b=>b.count), 1);
        const avg = delivered.reduce((s,d)=>s+d,0)/delivered.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Karşılama Hızı Dağılımı' : 'Order Fulfilment Speed Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Based on {delivered.length} delivered orders · avg {avg.toFixed(1)} days</p>
            <div className="flex items-end gap-3 h-24">
              {bucketData.map((b,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-600 font-bold">{b.count}</span>
                  <div className="w-full rounded-t" style={{ height: `${maxCount>0?(b.count/maxCount*72):2}px`, background: b.color, minHeight: b.count>0?'4px':'2px' }} />
                  <span className="text-[8px] text-gray-400 text-center leading-tight">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const last30Days = orders.filter(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        });
        const statusBreakdown = {
          Pending: last30Days.filter(o=>o.status==='Pending').length,
          Processing: last30Days.filter(o=>o.status==='Processing').length,
          Shipped: last30Days.filter(o=>o.status==='Shipped').length,
          Delivered: last30Days.filter(o=>o.status==='Delivered').length,
          Cancelled: last30Days.filter(o=>o.status==='Cancelled').length,
        };
        const total = last30Days.length;
        if (total === 0) return null;
        const activeRate = ((statusBreakdown.Delivered + statusBreakdown.Shipped) / total * 100);
        const stuckRate = ((statusBreakdown.Pending + statusBreakdown.Processing) / total * 100);
        const steps = [
          { label: 'Pending', count: statusBreakdown.Pending, color: '#94a3b8' },
          { label: 'Processing', count: statusBreakdown.Processing, color: '#f59e0b' },
          { label: 'Shipped', count: statusBreakdown.Shipped, color: '#3b82f6' },
          { label: 'Delivered', count: statusBreakdown.Delivered, color: '#10b981' },
          { label: 'Cancelled', count: statusBreakdown.Cancelled, color: '#ef4444' },
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Order Pipeline — Last 30 Days</h3>
            <p className="text-xs text-gray-500 mb-4">{total} orders · {activeRate.toFixed(0)}% progressing · {stuckRate.toFixed(0)}% awaiting action</p>
            <div className="flex items-center gap-1 h-10 mb-4 rounded-xl overflow-hidden">
              {steps.map((s,i) => s.count > 0 && (
                <div key={i} title={`${s.label}: ${s.count}`} className="h-full flex items-center justify-center text-white text-[9px] font-bold" style={{ width: `${(s.count/total)*100}%`, background: s.color, minWidth: '4px' }}>
                  {s.count/total > 0.07 ? s.count : ''}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1 text-center">
              {steps.map((s,i) => (
                <div key={i}>
                  <div className="text-xs font-bold" style={{ color: s.color }}>{s.count}</div>
                  <div className="text-[9px] text-gray-400">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const driverMap: Record<string, {total: number; delivered: number; cancelled: number; revenue: number}> = {};
        orders.filter(o => (o.assignedDriver as string)).forEach(o => {
          const drv = o.assignedDriver as string;
          if (!driverMap[drv]) driverMap[drv] = { total: 0, delivered: 0, cancelled: 0, revenue: 0 };
          driverMap[drv].total++;
          driverMap[drv].revenue += o.totalPrice;
          if (o.status === 'Delivered') driverMap[drv].delivered++;
          if (o.status === 'Cancelled') driverMap[drv].cancelled++;
        });
        const drivers = Object.entries(driverMap)
          .map(([name, d]) => ({ name, ...d, rate: d.total > 0 ? (d.delivered/d.total*100) : 0 }))
          .sort((a,b) => b.rate - a.rate);
        if (drivers.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Sürücü Performans Karnesi' : 'Driver Performance Scorecard'}</h3>
            <div className="space-y-2">
              {drivers.map((d,i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                  <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                  <span className="text-xs font-medium text-gray-800 truncate w-24">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${d.rate}%`, background: d.rate >= 80 ? '#10b981' : d.rate >= 60 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="text-xs font-bold w-10 text-right" style={{ color: d.rate >= 80 ? '#10b981' : d.rate >= 60 ? '#f59e0b' : '#ef4444' }}>{d.rate.toFixed(0)}%</span>
                  <span className="text-xs text-gray-400 w-12 text-right">{d.total} trips</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const data = months.map(m => {
          const mOrders = orders.filter(o => {
            const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
            return d.getFullYear() === m.year && d.getMonth() === m.month;
          });
          const total = mOrders.reduce((s,o)=>s+o.totalPrice,0);
          const cancelled = mOrders.filter(o=>o.status==='Cancelled');
          const cancelledRev = cancelled.reduce((s,o)=>s+o.totalPrice,0);
          return { label: m.label, total, cancelledRev, cancelledCount: cancelled.length, rate: total>0?(cancelledRev/total*100):0 };
        });
        const hasData = data.some(d=>d.total>0);
        if (!hasData) return null;
        const maxTotal = Math.max(...data.map(d=>d.total),1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Cancellation Revenue Loss — 6 Months</h3>
            <p className="text-xs text-gray-500 mb-4">Red = cancelled revenue · blue = fulfilled revenue</p>
            <div className="flex items-end gap-2 h-28">
              {data.map((d,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col justify-end" style={{ height: '88px' }}>
                    <div className="w-full rounded-t-sm bg-red-400" style={{ height: `${maxTotal>0?(d.cancelledRev/maxTotal*80):0}px`, minHeight: d.cancelledRev>0?'2px':'0' }} />
                    <div className="w-full bg-blue-400" style={{ height: `${maxTotal>0?((d.total-d.cancelledRev)/maxTotal*80):0}px`, minHeight: d.total-d.cancelledRev>0?'2px':'0' }} />
                  </div>
                  <span className="text-[9px] text-gray-400">{d.label}</span>
                  {d.rate > 0 && <span className="text-[8px] text-red-500 font-bold">{d.rate.toFixed(0)}%</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">Total lost revenue (6mo): {fmtAna(data.reduce((s,d)=>s+d.cancelledRev,0),'full',0)}</p>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now = new Date();
        const pending = orders.filter(o => o.status === 'Pending' || o.status === 'Processing');
        if (pending.length === 0) return null;
        const totalHeld = pending.reduce((s, o) => s + o.totalPrice, 0);
        const byStatus = {
          Pending: pending.filter(o => o.status === 'Pending'),
          Processing: pending.filter(o => o.status === 'Processing'),
        };
        const oldest = pending.reduce((oldest, o) => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          return d < oldest ? d : oldest;
        }, now);
        const oldestDays = Math.floor((now.getTime() - oldest.getTime()) / 86400000);
        const aging = [
          {label: '0-1 days', orders: pending.filter(o => { const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string); return (now.getTime()-d.getTime())/86400000 <= 1; })},
          {label: '2-3 days', orders: pending.filter(o => { const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string); const age=(now.getTime()-d.getTime())/86400000; return age>1&&age<=3; })},
          {label: '4-7 days', orders: pending.filter(o => { const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string); const age=(now.getTime()-d.getTime())/86400000; return age>3&&age<=7; })},
          {label: '7+ days', orders: pending.filter(o => { const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string); return (now.getTime()-d.getTime())/86400000>7; })},
        ];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Beklemedeki Sipariş Tutarı' : 'On-Hold Order Value'}</h3>
            <p className="text-xs text-gray-500 mb-4">{pending.length} orders holding {fmtAna(totalHeld,'full',0)} · oldest: {oldestDays}d</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-600">{byStatus.Pending.length}</div>
                <div className="text-[10px] text-gray-500">Pending</div>
                <div className="text-[9px] text-amber-400">{fmtAna(byStatus.Pending.reduce((s,o)=>s+o.totalPrice,0),'full',0)}</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-blue-600">{byStatus.Processing.length}</div>
                <div className="text-[10px] text-gray-500">Processing</div>
                <div className="text-[9px] text-blue-400">{fmtAna(byStatus.Processing.reduce((s,o)=>s+o.totalPrice,0),'full',0)}</div>
              </div>
            </div>
            <div className="space-y-1">
              {aging.map((a, i) => (
                <div key={i} className="flex justify-between text-xs p-2 rounded-lg" style={{background: i >= 2 ? '#fef2f2' : '#f8fafc'}}>
                  <span className="text-gray-600 font-medium">{a.label}</span>
                  <span className="font-bold" style={{color: i >= 2 ? '#ef4444' : '#6b7280'}}>{a.orders.length} orders · {fmtAna(a.orders.reduce((s,o)=>s+o.totalPrice,0),'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const delivered324 = orders.filter(o => o.status === 'Delivered');
        if (delivered324.length < 3) return null;
        const toTs324 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const lateOrders = delivered324.filter(o => {
          const created = toTs324(o.createdAt);
          const updated = toTs324((o as unknown as Record<string,unknown>).updatedAt);
          return updated > 0 && created > 0 && (updated - created) > 3 * 86400000;
        });
        const onTime = delivered324.length - lateOrders.length;
        const lateRate = (lateOrders.length / delivered324.length * 100).toFixed(1);
        const months324: Record<string, {late: number; total: number}> = {};
        delivered324.forEach(o => {
          const d = new Date(toTs324(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!months324[key]) months324[key] = {late: 0, total: 0};
          months324[key].total++;
          const created = toTs324(o.createdAt);
          const updated = toTs324((o as unknown as Record<string,unknown>).updatedAt);
          if (updated > 0 && created > 0 && (updated - created) > 3 * 86400000) months324[key].late++;
        });
        const monthKeys = Object.keys(months324).sort().slice(-6);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Geç Teslimat Oranı' : 'Late Delivery Rate'}</h3>
            <p className="text-xs text-gray-500 mb-4">Orders taking {'>'}3 days to deliver · Overall late rate: <span className="font-bold text-red-500">{lateRate}%</span></p>
            <div className="flex items-center gap-6 mb-4">
              {[{label: 'On-Time', val: onTime, color: '#10b981'}, {label: 'Late (>3d)', val: lateOrders.length, color: '#ef4444'}].map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{background: s.color}} />
                  <span className="text-sm font-bold text-gray-700">{s.val}</span>
                  <span className="text-xs text-gray-400">{s.label}</span>
                </div>
              ))}
            </div>
            {monthKeys.length >= 2 && (
              <div className="flex items-end gap-1 h-20">
                {monthKeys.map(k => {
                  const m = months324[k];
                  const rate = m.total > 0 ? m.late / m.total : 0;
                  return (
                    <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full rounded-t" style={{height: `${Math.max(rate * 80, 2)}px`, background: rate > 0.3 ? '#ef4444' : rate > 0.15 ? '#f59e0b' : '#10b981'}} />
                      <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.filter(o => o.status === 'Cancelled').length >= 2 && (() => {
        const cancelled330 = orders.filter(o => o.status === 'Cancelled');
        const cancelRate = orders.length > 0 ? (cancelled330.length / orders.length * 100).toFixed(1) : '0';
        const reasonMap: Record<string, number> = {};
        cancelled330.forEach(o => {
          const reason = (o as unknown as Record<string,unknown>).cancellationReason as string || (o as unknown as Record<string,unknown>).cancelReason as string || 'Not specified';
          reasonMap[reason] = (reasonMap[reason] || 0) + 1;
        });
        const reasons = Object.entries(reasonMap).map(([reason, count]) => ({reason, count})).sort((a, b) => b.count - a.count);
        const maxCount330 = Math.max(...reasons.map(r => r.count), 1);
        const cancelRevLost = cancelled330.reduce((s, o) => s + (o.totalPrice || 0), 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş İptali Analizi' : 'Order Cancellation Analysis'}</h3>
            <p className="text-xs text-gray-500 mb-4">{cancelled330.length} cancelled orders · {cancelRate}% rate · {fmtAna(cancelRevLost,'full',0)} revenue lost</p>
            <div className="space-y-2">
              {reasons.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 flex-1 truncate">{r.reason}</span>
                  <div className="w-32 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-red-400 transition-all" style={{width: `${(r.count / maxCount330) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-red-500 w-8 text-right">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 7 && (() => {
        const toTs332 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const days332 = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const dayData = days332.map(d => ({day: d, count: 0, revenue: 0}));
        orders.forEach(o => {
          const ts = toTs332(o.createdAt);
          if (!ts) return;
          const dow = new Date(ts).getDay();
          dayData[dow].count++;
          dayData[dow].revenue += o.totalPrice || 0;
        });
        const maxCount332 = Math.max(...dayData.map(d => d.count), 1);
        const busiest = dayData.reduce((a, b) => b.count > a.count ? b : a);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Haftanın Gününe Göre Siparişler' : 'Orders by Day of Week'}</h3>
            <p className="text-xs text-gray-500 mb-4">Busiest day: <span className="font-bold text-[#ff4000]">{busiest.day}</span> · {busiest.count} orders</p>
            <div className="flex items-end gap-2 h-20">
              {dayData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.count}</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max((d.count / maxCount332) * 60, 4)}px`, background: d.day === busiest.day ? '#ff4000' : '#6366f1'}} />
                  <span className="text-[9px] text-gray-400">{d.day}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && recurringOrders.length >= 2 && (() => {
        const active335 = recurringOrders.filter(r => r.active);
        const inactive335 = recurringOrders.filter(r => !r.active);
        const totalARR = active335.reduce((s, r) => {
          const mult = r.frequency === 'weekly' ? 52 : r.frequency === 'monthly' ? 12 : 4;
          return s + r.totalPrice * mult;
        }, 0);
        const freqBreak = ['weekly','monthly','quarterly'].map(f => ({
          freq: f,
          count: active335.filter(r => r.frequency === f).length,
          arr: active335.filter(r => r.frequency === f).reduce((s, r) => {
            const m = f === 'weekly' ? 52 : f === 'monthly' ? 12 : 4;
            return s + r.totalPrice * m;
          }, 0),
        }));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Abonelik Siparişi Sağlığı' : 'Recurring Order Health'}</h3>
            <p className="text-xs text-gray-500 mb-4">{active335.length} active subscriptions · {inactive335.length} paused · ARR: {fmtAna(totalARR,'full',0)}</p>
            <div className="grid grid-cols-3 gap-3">
              {freqBreak.map((f, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-400 capitalize mb-1">{f.freq}</p>
                  <p className="text-xl font-black text-gray-800">{f.count}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{fmtAna(f.arr,'K',0)} ARR</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const statusMix: Record<string, number> = {};
        orders.forEach(o => { statusMix[o.status] = (statusMix[o.status] || 0) + 1; });
        const statusColors: Record<string, string> = {Delivered:'#10b981',Processing:'#6366f1',Pending:'#f59e0b',Shipped:'#3b82f6',Cancelled:'#ef4444'};
        const statuses = Object.entries(statusMix).map(([s, c]) => ({status: s, count: c, pct: (c / orders.length) * 100})).sort((a, b) => b.count - a.count);
        const maxS = Math.max(...statuses.map(s => s.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Durumu Dağılımı' : 'Order Status Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">{orders.length} total orders · current pipeline snapshot</p>
            <div className="space-y-2">
              {statuses.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-24">{s.status}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(s.count / maxS) * 100}%`, background: statusColors[s.status] || '#94a3b8'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{s.pct.toFixed(0)}%</span>
                  <span className="text-xs font-bold w-8 text-right" style={{color: statusColors[s.status] || '#94a3b8'}}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.filter(o => o.status === 'Delivered').length >= 3 && (() => {
        const toTs349 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const delivTimes = orders
          .filter(o => o.status === 'Delivered')
          .map(o => {
            const created = toTs349(o.createdAt);
            const updated = toTs349((o as unknown as Record<string,unknown>).updatedAt || (o as unknown as Record<string,unknown>).deliveredAt);
            return (created && updated && updated > created) ? Math.floor((updated - created) / 86400000) : -1;
          })
          .filter(d => d >= 0 && d <= 60);
        if (delivTimes.length < 3) return null;
        const avg349 = (delivTimes.reduce((s, d) => s + d, 0) / delivTimes.length).toFixed(1);
        const sorted349 = [...delivTimes].sort((a, b) => a - b);
        const p50 = sorted349[Math.floor(sorted349.length / 2)];
        const p90 = sorted349[Math.floor(sorted349.length * 0.9)];
        const buckets349 = [
          {label:'Same day',max:1,count:0,color:'#10b981'},
          {label:'1–3d',max:3,count:0,color:'#6366f1'},
          {label:'4–7d',max:7,count:0,color:'#f59e0b'},
          {label:'8–14d',max:14,count:0,color:'#f97316'},
          {label:'15d+',max:999,count:0,color:'#ef4444'},
        ];
        delivTimes.forEach(d => { const b = buckets349.find(b => d < b.max); if (b) b.count++; });
        const maxB349 = Math.max(...buckets349.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Karşılama Süresi Dağılımı' : 'Fulfilment Time Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Days from order to delivery · Avg: {avg349}d · P50: {p50}d · P90: {p90}d</p>
            <div className="flex items-end gap-3 h-20">
              {buckets349.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxB349) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500 text-center">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 6 && (() => {
        const toTs356 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthItems: Record<string, number> = {};
        orders.forEach(o => {
          const d = new Date(toTs356(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const qty = (o.lineItems || []).reduce((s: number, li: {quantity?: number}) => s + (li.quantity || 1), 0);
          monthItems[key] = (monthItems[key] || 0) + qty;
        });
        const keys356 = Object.keys(monthItems).sort().slice(-8);
        if (keys356.length < 3) return null;
        const maxQty356 = Math.max(...keys356.map(k => monthItems[k]), 1);
        const totalItems = keys356.reduce((s, k) => s + monthItems[k], 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Aylık Sevkiyat Hacmi' : 'Monthly Shipment Volume'}</h3>
            <p className="text-xs text-gray-500 mb-4">Total line-item units shipped · {totalItems.toLocaleString('tr-TR')} over {keys356.length} months</p>
            <div className="flex items-end gap-2 h-24">
              {keys356.map(k => (
                <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{monthItems[k]}</span>
                  <div className="w-full rounded-t-lg bg-sky-400 transition-all" style={{height: `${Math.max((monthItems[k] / maxQty356) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && inventory.length >= 3 && (() => {
        const suppMap: Record<string, {count: number; stock: number; value: number}> = {};
        inventory.forEach(item => {
          const s = item.supplier || 'Unknown';
          if (!suppMap[s]) suppMap[s] = {count: 0, stock: 0, value: 0};
          suppMap[s].count++;
          suppMap[s].stock += item.stockLevel;
          suppMap[s].value += item.stockLevel * itemCostTRY(item, exchangeRates);
        });
        const supps363 = Object.entries(suppMap).filter(([s]) => s !== 'Unknown').map(([s, d]) => ({supplier: s, ...d})).sort((a, b) => b.value - a.value).slice(0, 7);
        if (supps363.length < 2) return null;
        const maxVal363 = Math.max(...supps363.map(s => s.value), 1);
        const colors363 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stok Değerine Göre En İyi Tedarikçiler' : 'Top Suppliers by Stock Value'}</h3>
            <p className="text-xs text-gray-500 mb-4">Current inventory value held per supplier</p>
            <div className="space-y-2">
              {supps363.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{s.supplier}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(s.value / maxVal363) * 100}%`, background: colors363[i % colors363.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-12 text-right">{s.count} SKU</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors363[i % colors363.length]}}>{fmtAna(s.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 8 && (() => {
        const toTs367 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const now367 = Date.now();
        const ageBuckets = [
          {label: '< 1d',  max: 1,   count: 0, color: '#10b981'},
          {label: '1–3d',  max: 3,   count: 0, color: '#6366f1'},
          {label: '4–7d',  max: 7,   count: 0, color: '#f59e0b'},
          {label: '8–14d', max: 14,  count: 0, color: '#f97316'},
          {label: '15d+',  max: 999, count: 0, color: '#ef4444'},
        ];
        const openOrders = orders.filter(o => !['Delivered','Cancelled'].includes(o.status));
        openOrders.forEach(o => {
          const created = toTs367(o.createdAt);
          if (!created) return;
          const ageDays = (now367 - created) / 86400000;
          const b = ageBuckets.find(b => ageDays < b.max);
          if (b) b.count++;
        });
        if (openOrders.length < 2) return null;
        const maxAB = Math.max(...ageBuckets.map(b => b.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Açık Sipariş Yaşı Dağılımı' : 'Open Order Age Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">{openOrders.length} open orders (Pending + Processing + Shipped)</p>
            <div className="flex items-end gap-3 h-20">
              {ageBuckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: b.color}}>{b.count}</span>
                  <div className="w-full rounded-t-lg" style={{height: `${Math.max((b.count / maxAB) * 60, 4)}px`, background: b.color}} />
                  <span className="text-[9px] text-gray-500">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && recurringOrders.length >= 2 && (() => {
        const freqMult: Record<string, number> = {weekly: 4.33, monthly: 1, quarterly: 0.333};
        const activeRec = recurringOrders.filter(r => r.active);
        if (activeRec.length < 2) return null;
        const mrr = activeRec.reduce((s, r) => s + r.totalPrice * (freqMult[r.frequency] || 1), 0);
        const arr = mrr * 12;
        const byCustomer = Object.entries(
          activeRec.reduce((acc, r) => { acc[r.customerName] = (acc[r.customerName] || 0) + r.totalPrice * (freqMult[r.frequency] || 1); return acc; }, {} as Record<string, number>)
        ).map(([c, v]) => ({c, v})).sort((a, b) => b.v - a.v).slice(0, 5);
        const maxMRR = Math.max(...byCustomer.map(d => d.v), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Yinelenen Gelir Genel Bakış' : 'Recurring Revenue Overview'}</h3>
            <div className="flex gap-6 mb-4">
              <div><p className="text-xl font-black text-[#ff4000]">{fmtAna(mrr,'full',0)}</p><p className="text-[10px] text-gray-400">MRR</p></div>
              <div><p className="text-xl font-black text-indigo-600">{fmtAna(arr,'full',0)}</p><p className="text-[10px] text-gray-400">ARR</p></div>
              <div><p className="text-xl font-black text-gray-700">{activeRec.length}</p><p className="text-[10px] text-gray-400">active subs</p></div>
            </div>
            <div className="space-y-1.5">
              {byCustomer.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{d.c}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-400" style={{width: `${(d.v / maxMRR) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-indigo-600 w-24 text-right">{fmtAna(d.v,'full',0)}/mo</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.filter(o => o.status === 'Delivered').length >= 4 && (() => {
        const toTs375 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthOTD: Record<string, {total: number; onTime: number}> = {};
        orders.filter(o => o.status === 'Delivered').forEach(o => {
          const created = toTs375(o.createdAt);
          const updated = toTs375((o as unknown as Record<string,unknown>).updatedAt || (o as unknown as Record<string,unknown>).deliveredAt);
          if (!created) return;
          const d = new Date(created);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthOTD[key]) monthOTD[key] = {total: 0, onTime: 0};
          monthOTD[key].total++;
          const days = (updated && updated > created) ? (updated - created) / 86400000 : 0;
          if (days > 0 && days <= 3) monthOTD[key].onTime++;
        });
        const keys375 = Object.keys(monthOTD).sort().slice(-7);
        if (keys375.length < 2) return null;
        const otdData = keys375.map(k => ({k, rate: monthOTD[k].total > 0 ? (monthOTD[k].onTime / monthOTD[k].total) * 100 : 0, total: monthOTD[k].total}));
        const avgOTD = otdData.reduce((s, d) => s + d.rate, 0) / otdData.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">On-Time Delivery Rate (≤3d)</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly OTD % · Avg: <span className="font-bold" style={{color: avgOTD >= 80 ? '#10b981' : avgOTD >= 60 ? '#f59e0b' : '#ef4444'}}>{avgOTD.toFixed(1)}%</span></p>
            <div className="flex items-end gap-2 h-24">
              {otdData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{d.rate.toFixed(0)}%</span>
                  <div className="w-full rounded-t-lg transition-all" style={{height: `${Math.max(d.rate / 100 * 72, 4)}px`, background: d.rate >= 80 ? '#10b981' : d.rate >= 60 ? '#f59e0b' : '#ef4444'}} />
                  <span className="text-[9px] text-gray-400">{d.k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const diffs: number[] = [];
        orders.forEach(o => {
          const created = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          const delivered = (o as unknown as Record<string,unknown>).deliveredAt;
          if (!created || !delivered) return;
          const dDate = (delivered as {toDate?:()=>Date}).toDate?.() ?? new Date(delivered as string);
          const diff = Math.round((dDate.getTime() - created.getTime()) / 86400000);
          if (diff >= 0 && diff <= 30) diffs.push(diff);
        });
        if (diffs.length < 3) return null;
        const buckets = [0,1,2,3,5,7,10,15,20,30];
        const labels = ['0d','1d','2d','3d','4-5d','6-7d','8-10d','11-15d','16-20d','21-30d'];
        const counts = buckets.map((b, i) => ({
          label: labels[i],
          count: diffs.filter(d => d >= b && d < (buckets[i+1] ?? 31)).length,
        }));
        const maxC = Math.max(...counts.map(c => c.count), 1);
        const avg = (diffs.reduce((a,b) => a+b,0) / diffs.length).toFixed(1);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Teslimat Süresi Dağılımı' : 'Delivery Lead Time Distribution'}</h3>
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">Avg {avg}d</span>
            </div>
            <div className="flex items-end gap-1 h-24">
              {counts.map(c => (
                <div key={c.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm transition-all" style={{height: `${(c.count / maxC) * 80}px`, background: '#3b82f6', minHeight: c.count > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const bucketLabels = ['1','2','3','4','5','6-10','11+'];
        const bucketCounts = [0,0,0,0,0,0,0];
        orders.forEach(o => {
          const n = (o.lineItems ?? []).length;
          if (n === 0) return;
          if (n <= 5) bucketCounts[n-1]++;
          else if (n <= 10) bucketCounts[5]++;
          else bucketCounts[6]++;
        });
        const maxC = Math.max(...bucketCounts, 1);
        const totalOrders = bucketCounts.reduce((a,b) => a+b, 0);
        if (totalOrders < 3) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Kalem Sayısına Göre Siparişler' : 'Orders by Line Item Count'}</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {bucketLabels.map((label, i) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{bucketCounts[i] > 0 ? bucketCounts[i] : ''}</span>
                  <div className="w-full rounded-sm transition-all" style={{height: `${(bucketCounts[i] / maxC) * 72}px`, background: '#0ea5e9', minHeight: bucketCounts[i] > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 text-center">items per order</p>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const statusCounts: Record<string, number> = {};
        orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1; });
        const total = orders.length;
        const statusColors: Record<string, string> = {
          'Pending': '#f59e0b', 'Processing': '#3b82f6', 'Shipped': '#8b5cf6',
          'Delivered': '#22c55e', 'Cancelled': '#ef4444',
        };
        const rows = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Duruma Göre Siparişler' : 'Orders by Status'}</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([status, count]) => (
                <div key={status} style={{width: `${(count / total) * 100}%`, background: statusColors[status] ?? '#6b7280'}} title={`${status}: ${count}`} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {rows.map(([status, count]) => (
                <div key={status} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: statusColors[status] ?? '#6b7280'}} />
                  <span className="text-gray-600 truncate">{status}</span>
                  <span className="ml-auto font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const customerOrderCounts: Record<string, number> = {};
        orders.forEach(o => {
          const cid = (o as unknown as Record<string,unknown>).customerId as string | undefined
            || (o as unknown as Record<string,unknown>).customerName as string | undefined
            || 'Unknown';
          customerOrderCounts[cid] = (customerOrderCounts[cid] ?? 0) + 1;
        });
        const oneTime = Object.values(customerOrderCounts).filter(c => c === 1).length;
        const returning = Object.values(customerOrderCounts).filter(c => c >= 2 && c <= 5).length;
        const loyal = Object.values(customerOrderCounts).filter(c => c > 5).length;
        const total = oneTime + returning + loyal;
        if (total === 0) return null;
        const segments = [
          {label: 'One-time', count: oneTime, color: '#94a3b8'},
          {label: 'Returning (2-5)', count: returning, color: '#3b82f6'},
          {label: 'Loyal (6+)', count: loyal, color: '#ff4000'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Müşteri Alışveriş Sıklığı' : 'Customer Purchase Frequency'}</h3>
            <div className="flex h-5 rounded-full overflow-hidden mb-3">
              {segments.map(s => s.count > 0 && (
                <div key={s.label} style={{width: `${(s.count/total)*100}%`, background: s.color}} title={`${s.label}: ${s.count}`} />
              ))}
            </div>
            <div className="space-y-1">
              {segments.map(s => (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{background: s.color}} />
                    <span className="text-gray-600">{s.label}</span>
                  </div>
                  <span className="font-bold">{s.count} <span className="font-normal text-gray-400">({total > 0 ? Math.round((s.count/total)*100) : 0}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 3 && (() => {
        const now = new Date();
        const stuck = orders.filter(o => {
          if (o.status !== 'Processing' && o.status !== 'Pending') return false;
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return false;
          return (now.getTime() - d.getTime()) / 86400000 > 7;
        }).map(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : new Date();
          const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
          const cid = (o as unknown as Record<string,unknown>).customerName as string | undefined
            || (o as unknown as Record<string,unknown>).customerId as string | undefined
            || 'Unknown';
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          return {id: o.id, status: o.status, days, customer: cid, total};
        }).sort((a, b) => b.days - a.days).slice(0, 6);
        if (stuck.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm font-medium text-green-700">No stuck orders — all moving normally</span>
          </div>
        );
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>⏳ Stuck Orders (&gt;7 days)</span>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">{stuck.length}</span>
            </h3>
            <div className="space-y-2">
              {stuck.map((o, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex-1">
                    <span className="text-gray-700 font-medium">{o.customer}</span>
                    <span className="ml-2 text-gray-400">{o.status}</span>
                  </div>
                  <span className="font-bold ml-2" style={{color: o.days > 14 ? '#ef4444' : '#f59e0b'}}>{o.days}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 7 && (() => {
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const dayTotals: {sum: number; count: number}[] = Array.from({length: 7}, () => ({sum: 0, count: 0}));
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const dow = (d.getDay() + 6) % 7;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          dayTotals[dow].sum += total;
          dayTotals[dow].count++;
        });
        const avgs = dayTotals.map(d => d.count > 0 ? d.sum / d.count : 0);
        const maxAvg = Math.max(...avgs, 1);
        const bestDay = avgs.indexOf(Math.max(...avgs));
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Güne Göre Ortalama Sipariş Tutarı' : 'Avg Order Value by Day'}</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">Best: {days[bestDay]}</span>
            </div>
            <div className="flex items-end gap-1.5 h-20 mb-1">
              {avgs.map((avg, i) => (
                <div key={days[i]} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-sm transition-all" style={{height: `${(avg / maxAvg) * 56}px`, background: i === bestDay ? '#ff4000' : '#3b82f6', minHeight: avg > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{days[i].slice(0,2)}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 text-center">average order value (₺)</p>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {delivered: number; total: number}> = {};
        orders.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          if (o.status === 'Processing' || o.status === 'Pending') return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key] = {delivered: 0, total: 0};
          byMonth[key].total++;
          if (o.status === 'Delivered') byMonth[key].delivered++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const rows = months.map(m => ({
          month: m.slice(5),
          rate: byMonth[m].total > 0 ? Math.round((byMonth[m].delivered / byMonth[m].total) * 100) : 0,
        }));
        const maxR = Math.max(...rows.map(r => r.rate), 1);
        const avgRate = rows.reduce((s, r) => s + r.rate, 0) / rows.length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Teslimat Başarı Oranı' : 'Delivery Success Rate'}</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{avgRate.toFixed(0)}% avg</span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.rate}%</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.rate / maxR) * 56}px`, background: r.rate >= 90 ? '#22c55e' : r.rate >= 70 ? '#f59e0b' : '#ef4444', minHeight: r.rate > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const locationCounts: Record<string, {count: number; revenue: number}> = {};
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const city = (oR.shippingCity as string|undefined) ?? (oR.city as string|undefined)
            ?? (oR.deliveryCity as string|undefined) ?? (oR.address as string|undefined)?.split(',').pop()?.trim()
            ?? 'Unknown';
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0) * ((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (!locationCounts[city]) locationCounts[city] = {count: 0, revenue: 0};
          locationCounts[city].count++;
          locationCounts[city].revenue += total;
        });
        const top = Object.entries(locationCounts).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
        if (top.length <= 1) return null;
        const maxC = top[0][1].count;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'En Çok Teslimat Yapılan Konumlar' : 'Top Delivery Locations'}</h3>
            <div className="space-y-2">
              {top.map(([city, d], i) => (
                <div key={city} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{city}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(d.count / maxC) * 100}%`, background: '#0ea5e9'}} />
                  </div>
                  <span className="text-xs font-bold w-6 text-right text-blue-600">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const funnel = [
          {label:'Pending',   count: orders.filter(o => o.status === 'Pending').length,   color:'#f59e0b'},
          {label:'Processing',count: orders.filter(o => o.status === 'Processing').length, color:'#3b82f6'},
          {label:'Shipped',   count: orders.filter(o => o.status === 'Shipped').length,    color:'#8b5cf6'},
          {label:'Delivered', count: orders.filter(o => o.status === 'Delivered').length,  color:'#22c55e'},
        ];
        const maxCount = Math.max(...funnel.map(f => f.count), 1);
        const totalOrders = orders.length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Karşılama Hunisi' : 'Order Fulfillment Funnel'}</h3>
            <div className="space-y-2">
              {funnel.map(f => {
                const w = (f.count / maxCount) * 100;
                return (
                  <div key={f.label} className="flex items-center gap-2">
                    <span className="text-xs w-20 text-gray-600">{f.label}</span>
                    <div className="flex-1 flex">
                      <div className="h-6 rounded-sm flex items-center px-2 transition-all" style={{width: `${w}%`, background: f.color, minWidth: f.count > 0 ? 24 : 0}}>
                        <span className="text-white text-xs font-bold">{f.count > 0 ? f.count : ''}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{totalOrders > 0 ? Math.round((f.count/totalOrders)*100) : 0}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const byMonth: Record<string, {sum: number; count: number}> = {};
        orders.forEach(o => {
          const created = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          const delivered = (o as unknown as Record<string,unknown>).deliveredAt ?? (o as unknown as Record<string,unknown>).completedAt;
          if (!created || !delivered || o.status !== 'Delivered') return;
          const dDate = (delivered as {toDate?:()=>Date}).toDate?.() ?? new Date(delivered as string);
          const diff = Math.round((dDate.getTime() - created.getTime()) / 86400000);
          if (diff < 0 || diff > 60) return;
          const key = `${created.getFullYear()}-${String(created.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key] = {sum: 0, count: 0};
          byMonth[key].sum += diff;
          byMonth[key].count++;
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) {
          // Fallback: show order status counts
          const delivered = orders.filter(o => o.status === 'Delivered').length;
          const total = orders.length;
          const rate = total > 0 ? Math.round((delivered/total)*100) : 0;
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'Teslimat Performansı' : 'Delivery Performance'}</h3>
              <p className="text-3xl font-bold text-green-500">{rate}%</p>
              <p className="text-xs text-gray-500">{delivered}/{total} orders delivered</p>
            </div>
          );
        }
        const rows = months.map(m => ({month: m.slice(5), avg: byMonth[m].count > 0 ? byMonth[m].sum / byMonth[m].count : 0}));
        const maxAvg = Math.max(...rows.map(r => r.avg), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aya Göre Ortalama Teslim Süresi' : 'Avg Delivery Days by Month'}</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {rows.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{r.avg.toFixed(1)}d</span>
                  <div className="w-full rounded-sm" style={{height: `${(r.avg / maxAvg) * 56}px`, background: r.avg <= 3 ? '#22c55e' : r.avg <= 7 ? '#f59e0b' : '#ef4444', minHeight: r.avg > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{r.month}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        let single = 0, multi = 0, bulk = 0;
        let singleRev = 0, multiRev = 0, bulkRev = 0;
        orders.forEach(o => {
          const n = (o.lineItems ?? []).length;
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total === 'number' ? oR.total as number
            : (o.lineItems ?? []).reduce((s, li) => { const lr = li as unknown as Record<string,unknown>; return s + ((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); }, 0);
          if (n <= 1) { single++; singleRev += total; }
          else if (n <= 5) { multi++; multiRev += total; }
          else { bulk++; bulkRev += total; }
        });
        const total = single + multi + bulk;
        const segments = [
          {label:'Single item', count: single, rev: singleRev, color:'#94a3b8'},
          {label:'2-5 items', count: multi, rev: multiRev, color:'#3b82f6'},
          {label:'6+ items', count: bulk, rev: bulkRev, color:'#ff4000'},
        ];
        const maxRev = Math.max(singleRev, multiRev, bulkRev, 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Karmaşıklığı Dağılımı' : 'Order Complexity Breakdown'}</h3>
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {segments.map(s => s.count > 0 && <div key={s.label} style={{width:`${(s.count/total)*100}%`,background:s.color}} />)}
            </div>
            <div className="space-y-2">
              {segments.map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:s.color}} />
                  <span className="text-xs text-gray-600 flex-1">{s.label}</span>
                  <span className="text-xs font-bold">{s.count}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-2.5 overflow-hidden ml-1">
                    <div className="h-full rounded-full" style={{width:`${(s.rev/maxRev)*100}%`,background:s.color}} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const shipped = orders.filter(o => o.status === 'Shipped' || o.status === 'Delivered');
        if (shipped.length < 3) return null;
        const byMonth: Record<string, number> = {};
        shipped.forEach(o => {
          const d = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          byMonth[key] = (byMonth[key] ?? 0) + 1;
        });
        const months = Object.keys(byMonth).sort().slice(-8);
        if (months.length < 2) return null;
        const vals = months.map(m => byMonth[m]);
        const maxV = Math.max(...vals, 1);
        const trend = vals[vals.length-1] - vals[0];
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Aya Göre Sevk Edilen Siparişler' : 'Shipped Orders by Month'}</h3>
              <span className="text-xs" style={{color: trend >= 0 ? '#22c55e' : '#ef4444'}}>
                {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)} trend
              </span>
            </div>
            <div className="flex items-end gap-2 h-20 mb-1">
              {vals.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{v}</span>
                  <div className="w-full rounded-sm" style={{height: `${(v/maxV)*56}px`, background: '#8b5cf6', minHeight: v > 0 ? 2 : 0}} />
                  <span className="text-[9px] text-gray-400">{months[i]?.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && (() => {
        const recurringCount = (recurringOrders ?? []).length;
        if (recurringCount === 0) return null;
        const byFreq: Record<string,number> = {};
        (recurringOrders ?? []).forEach(ro => {
          const roR = ro as unknown as Record<string,unknown>;
          const freq = (roR.frequency as string|undefined) ?? (roR.interval as string|undefined) ?? 'Other';
          byFreq[freq] = (byFreq[freq]??0)+1;
        });
        const totalValue = (recurringOrders ?? []).reduce((s,ro) => {
          const roR = ro as unknown as Record<string,unknown>;
          return s + ((roR.totalAmount as number|undefined) ?? (roR.total as number|undefined) ?? 0);
        }, 0);
        const rows = Object.entries(byFreq).sort((a,b)=>b[1]-a[1]);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Abonelik Siparişleri' : 'Recurring Orders'}</h3>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{recurringCount} active</span>
            </div>
            <div className="flex items-center gap-4 mb-2">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-500">{recurringCount}</p>
                <p className="text-[10px] text-gray-500">subscriptions</p>
              </div>
              {totalValue > 0 && <div className="text-center">
                <p className="text-2xl font-bold text-brand">{fmtAna(totalValue,'K',1)}</p>
                <p className="text-[10px] text-gray-500">period value</p>
              </div>}
            </div>
            {rows.length > 0 && <div className="flex flex-wrap gap-1">
              {rows.map(([freq,n])=>(
                <span key={freq} className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{freq}: {n}</span>
              ))}
            </div>}
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        // Segment by days since order creation
        const now = new Date();
        const segments = [{label:'≤1d',min:0,max:1,color:'#22c55e'},{label:'2-3d',min:1,max:3,color:'#84cc16'},
          {label:'4-7d',min:3,max:7,color:'#f59e0b'},{label:'8-14d',min:7,max:14,color:'#ef4444'},{label:'14d+',min:14,max:9999,color:'#7c3aed'}];
        const counts = segments.map(s=>({...s,count:0}));
        orders.filter(o=>o.status==='Delivered').forEach(o=>{
          const created = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
          const deliv = (o as unknown as Record<string,unknown>).deliveredAt ?? (o as unknown as Record<string,unknown>).completedAt;
          if (!created) return;
          const end = deliv ? ((deliv as {toDate?:()=>Date}).toDate?.()??new Date(deliv as string)) : now;
          const days = (end.getTime()-created.getTime())/86400000;
          const seg = counts.find(s=>days>=s.min&&days<s.max);
          if (seg) seg.count++;
        });
        const totalDelivered = counts.reduce((s,c)=>s+c.count,0);
        if (totalDelivered < 2) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Teslim Edilen Sipariş Süreleri' : 'Delivered Order Lead Times'}</h3>
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {counts.map(s=>s.count>0&&<div key={s.label} style={{width:`${(s.count/totalDelivered)*100}%`,background:s.color}} />)}
            </div>
            <div className="grid grid-cols-5 gap-1 text-center">
              {counts.map(s=>(
                <div key={s.label}>
                  <p className="text-sm font-bold" style={{color:s.color}}>{s.count}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 3 && quotations.length >= 3 && (() => {
        const convertedQuoteIds = new Set(orders.map(o=>(o as unknown as Record<string,unknown>).quotationId as string|undefined).filter(Boolean));
        const totalQuotes = quotations.length;
        const converted = convertedQuoteIds.size;
        const convRate = totalQuotes>0 ? Math.round((converted/totalQuotes)*100) : 0;
        const unconverted = totalQuotes-converted;
        // Conversion by month
        const convByMonth: Record<string,{total:number;conv:number}> = {};
        quotations.forEach(q => {
          const d = q.createdAt ? ((q.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(q.createdAt as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!convByMonth[key]) convByMonth[key]={total:0,conv:0};
          convByMonth[key].total++;
          const qR = q as unknown as Record<string,unknown>;
          if (convertedQuoteIds.has(qR.id as string|undefined??'')) convByMonth[key].conv++;
        });
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Tekliften Siparişe Dönüşüm' : 'Quote-to-Order Conversion'}</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="relative w-16 h-16 flex-shrink-0">
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="25" fill="none" stroke="#e5e7eb" strokeWidth="7"/>
                  <circle cx="32" cy="32" r="25" fill="none" stroke="#22c55e" strokeWidth="7"
                    strokeDasharray={`${(convRate/100)*157} 157`} strokeDashoffset="39" strokeLinecap="round"/>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-green-600">{convRate}%</span>
                </div>
              </div>
              <div className="flex-1 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Total Quotes</span><span className="font-bold">{totalQuotes}</span></div>
                <div className="flex justify-between"><span className="text-green-600">Converted</span><span className="font-bold text-green-600">{converted}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Pending</span><span className="font-bold">{unconverted}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const cityRev: Record<string,number> = {};
        orders.forEach(o => {
          const oR = o as unknown as Record<string,unknown>;
          const city = (oR.shippingCity as string|undefined)??(oR.city as string|undefined)??(oR.deliveryCity as string|undefined)??'Unknown';
          if (city==='Unknown') return;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          cityRev[city]=(cityRev[city]??0)+total;
        });
        const rows = Object.entries(cityRev).sort((a,b)=>b[1]-a[1]).slice(0,6);
        if (rows.length<2) return null;
        const maxRev=rows[0][1];
        const totalRev=rows.reduce((s,[,v])=>s+v,0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Teslimat Şehrine Göre Ciro' : 'Revenue by Delivery City'}</h3>
            <div className="space-y-2">
              {rows.map(([city,rev],i)=>(
                <div key={city} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{city}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${(rev/maxRev)*100}%`,background:'#0ea5e9'}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round((rev/totalRev)*100)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const pipeline = [
          {status:'Pending',   count:orders.filter(o=>o.status==='Pending').length,   color:'#f59e0b', icon:'⏳'},
          {status:'Processing',count:orders.filter(o=>o.status==='Processing').length, color:'#3b82f6', icon:'⚙️'},
          {status:'Shipped',   count:orders.filter(o=>o.status==='Shipped').length,    color:'#8b5cf6', icon:'🚚'},
        ];
        const totalActive = pipeline.reduce((s,p)=>s+p.count,0);
        const delivered = orders.filter(o=>o.status==='Delivered').length;
        const cancelled = orders.filter(o=>o.status==='Cancelled').length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aktif Sipariş Hattı' : 'Active Order Pipeline'}</h3>
            <div className="space-y-2 mb-3">
              {pipeline.map(p=>(
                <div key={p.status} className="flex items-center gap-2">
                  <span className="text-sm">{p.icon}</span>
                  <span className="text-xs text-gray-600 w-20">{p.status}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    {totalActive>0&&<div className="h-full rounded-full flex items-center pl-2" style={{width:`${(p.count/Math.max(totalActive,1))*100}%`,background:p.color,minWidth:p.count>0?24:0}}>
                      <span className="text-white text-xs font-bold">{p.count>0?p.count:''}</span>
                    </div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 border-t pt-2">
              <span className="text-green-600 font-medium">✓ {delivered} delivered</span>
              <span className="text-red-500">{cancelled} cancelled</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const withNotes = orders.filter(o=>{ const oR=o as unknown as Record<string,unknown>; return !!(oR.notes||oR.specialInstructions||oR.comments||oR.note); });
        const priorityOrders = orders.filter(o=>{ const oR=o as unknown as Record<string,unknown>; return (oR.priority as string|undefined)==='high'||(oR.urgent as boolean|undefined)===true||(oR.rush as boolean|undefined)===true; });
        const avgLineItems = orders.length>0 ? (orders.reduce((s,o)=>s+(o.lineItems??[]).length,0)/orders.length).toFixed(1) : '0';
        const pendingCount = orders.filter(o=>o.status==='Pending').length;
        const processingCount = orders.filter(o=>o.status==='Processing').length;
        const stats = [
          {label:'With Notes', val:withNotes.length, total:orders.length, color:'#3b82f6'},
          {label:'Priority', val:priorityOrders.length, total:orders.length, color:'#ef4444'},
          {label:'Pending', val:pendingCount, total:orders.length, color:'#f59e0b'},
          {label:'Processing', val:processingCount, total:orders.length, color:'#8b5cf6'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Operasyonları Genel Bakış' : 'Order Operations Overview'}</h3>
            <div className="grid grid-cols-2 gap-2">
              {stats.map(s=>(
                <div key={s.label} className="rounded-xl p-3" style={{background:`${s.color}10`}}>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[10px] text-gray-500">{s.label}</p>
                  {s.total>0&&<p className="text-[9px] text-gray-400">{Math.round((s.val/s.total)*100)}% of {s.total}</p>}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">avg {avgLineItems} line items/order</p>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const buckets = [{label:'1-5',min:0,max:5},{label:'6-20',min:5,max:20},{label:'21-50',min:20,max:50},{label:'51-100',min:50,max:100},{label:'100+',min:100,max:Infinity}];
        const data = buckets.map(b=>({...b,count:0,revenue:0}));
        orders.forEach(o => {
          const totalQty = (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??1); },0);
          const oR = o as unknown as Record<string,unknown>;
          const total = typeof oR.total==='number' ? oR.total as number
            : (o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          const bucket = data.find(b=>totalQty>b.min&&totalQty<=b.max);
          if (bucket) { bucket.count++; bucket.revenue+=total; }
        });
        const maxCount = Math.max(...data.map(b=>b.count),1);
        const colors=['#94a3b8','#3b82f6','#f59e0b','#ff4000','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Toplam Miktara Göre Siparişler' : 'Orders by Total Quantity'}</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {data.map((b,i)=>(
                <div key={b.label} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{b.count>0?b.count:''}</span>
                  <div className="w-full rounded-sm" style={{height:`${(b.count/maxCount)*56}px`,background:colors[i],minHeight:b.count>0?2:0}}/>
                  <span className="text-[9px] text-gray-400">{b.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 text-center">units per order</p>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const fulfilled = orders
          .filter(o=>o.status==='Delivered')
          .map(o=>{
            const created = o.createdAt ? ((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)) : null;
            const delivered = (o as unknown as Record<string,unknown>).deliveredAt??(o as unknown as Record<string,unknown>).completedAt;
            if (!created||!delivered) return null;
            const dDate = (delivered as {toDate?:()=>Date}).toDate?.()??new Date(delivered as string);
            const hours = (dDate.getTime()-created.getTime())/3600000;
            if (hours<0||hours>8760) return null;
            const cid=(o as unknown as Record<string,unknown>).customerName as string|undefined||(o as unknown as Record<string,unknown>).customerId as string|undefined||'Unknown';
            return {customer:cid,hours,days:hours/24};
          })
          .filter((o): o is NonNullable<typeof o> => o!==null)
          .sort((a,b)=>a.hours-b.hours)
          .slice(0,5);
        if (fulfilled.length<2) {
          const deliveredCount=orders.filter(o=>o.status==='Delivered').length;
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'Teslim Edilen Siparişler' : 'Delivered Orders'}</h3>
              <p className="text-3xl font-bold text-green-500">{deliveredCount}</p>
              <p className="text-xs text-gray-500">orders successfully delivered</p>
            </div>
          );
        }
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">⚡ Fastest Fulfilled Orders</h3>
            <div className="space-y-2">
              {fulfilled.map((o,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{o.customer}</span>
                  <span className="font-bold ml-2" style={{color:o.hours<24?'#22c55e':o.hours<72?'#3b82f6':'#6b7280'}}>
                    {o.hours<24?`${o.hours.toFixed(0)}h`:`${o.days.toFixed(1)}d`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        let weekdayCount=0,weekendCount=0,weekdayRev=0,weekendRev=0;
        orders.forEach(o=>{
          const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null;
          if(!d) return;
          const oR=o as unknown as Record<string,unknown>;
          const total=typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0);
          const isWeekend=d.getDay()===0||d.getDay()===6;
          if(isWeekend){weekendCount++;weekendRev+=total;}
          else{weekdayCount++;weekdayRev+=total;}
        });
        const totalOrders=weekdayCount+weekendCount;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Hafta İçi ve Hafta Sonu Siparişleri' : 'Weekday vs Weekend Orders'}</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              <div style={{width:`${(weekdayCount/Math.max(totalOrders,1))*100}%`,background:'#3b82f6'}}/>
              <div style={{width:`${(weekendCount/Math.max(totalOrders,1))*100}%`,background:'#f59e0b'}}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[{label:'Weekday',count:weekdayCount,rev:weekdayRev,color:'#3b82f6'},{label:'Weekend',count:weekendCount,rev:weekendRev,color:'#f59e0b'}].map(s=>(
                <div key={s.label} className="rounded-xl p-3" style={{background:`${s.color}12`}}>
                  <p className="text-sm font-bold" style={{color:s.color}}>{s.count} orders</p>
                  <p className="text-[10px] text-gray-500">{s.label}</p>
                  {s.rev>0&&<p className="text-[10px] text-gray-400">{fmtAna(s.rev,'K',1)} rev</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const now=new Date();
        const d90=new Date(now.getTime()-90*86400000);
        const recent=orders.filter(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; return d&&d>=d90; }).sort((a,b)=>{ const da=a.createdAt?((a.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(a.createdAt as string)):new Date(0); const db=b.createdAt?((b.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(b.createdAt as string)):new Date(0); return da.getTime()-db.getTime(); });
        if(recent.length<5) return null;
        const vals=recent.map(o=>{ const oR=o as unknown as Record<string,unknown>; return typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0); });
        const step=Math.max(1,Math.floor(vals.length/30));
        const sampled=vals.filter((_,i)=>i%step===0);
        const maxV=Math.max(...sampled,1);
        const w=240;const h=60;const pad=8;
        const pts=sampled.map((v,i)=>`${pad+(i/(sampled.length-1))*(w-2*pad)},${h-pad-(v/maxV)*(h-2*pad)}`).join(' ');
        const avgVal=vals.reduce((a,b)=>a+b,0)/vals.length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">Order Values (90d)</h3>
              <span className="text-xs text-gray-500">avg {fmtAna(avgVal,'K',1)}</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
              <line x1={pad} y1={h-pad-(avgVal/maxV)*(h-2*pad)} x2={w-pad} y2={h-pad-(avgVal/maxV)*(h-2*pad)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4"/>
              <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 5 && (() => {
        const orderValues=orders.map(o=>{ const oR=o as unknown as Record<string,unknown>; return typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s,li)=>{ const lr=li as unknown as Record<string,unknown>; return s+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0); }).filter(v=>v>0);
        if(orderValues.length<3) return null;
        const sorted=[...orderValues].sort((a,b)=>a-b);
        const min=sorted[0]; const max=sorted[sorted.length-1];
        const range=max-min||1;
        const bucketCount=6;
        const bucketSize=range/bucketCount;
        const buckets=Array.from({length:bucketCount},(_,i)=>({min:min+i*bucketSize,max:min+(i+1)*bucketSize,count:0}));
        orderValues.forEach(v=>{ const idx=Math.min(Math.floor((v-min)/bucketSize),bucketCount-1); buckets[idx].count++; });
        const maxCount=Math.max(...buckets.map(b=>b.count),1);
        const median=sorted[Math.floor(sorted.length/2)];
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Sipariş Tutarı Dağılımı' : 'Order Value Distribution'}</h3>
              <span className="text-xs text-gray-500">median {fmtAna(median,'K',1)}</span>
            </div>
            <div className="flex items-end gap-1 h-20 mb-1">
              {buckets.map((b,i)=>(
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-gray-500">{b.count>0?b.count:''}</span>
                  <div className="w-full rounded-sm" style={{height:`${(b.count/maxCount)*56}px`,background:'#6366f1',minHeight:b.count>0?2:0}}/>
                  <span className="text-[8px] text-gray-400">{b.min>=1000?`₺${(b.min/1000).toFixed(0)}k`:`₺${b.min.toFixed(0)}`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'lojistik' && orders.length >= 1 && (() => {
        const now=new Date();
        const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
        const thisMonth=orders.filter(o=>{ const d=o.createdAt?((o.createdAt as {toDate?:()=>Date}).toDate?.()??new Date(o.createdAt as string)):null; return d&&d>=monthStart; });
        const shipped=thisMonth.filter(o=>o.status==='Shipped'||o.status==='Delivered').length;
        const pending=thisMonth.filter(o=>o.status==='Pending').length;
        const processing=thisMonth.filter(o=>o.status==='Processing').length;
        const rev=thisMonth.reduce((s,o)=>{ const oR=o as unknown as Record<string,unknown>; return s+(typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s2,li)=>{ const lr=li as unknown as Record<string,unknown>; return s2+((lr.quantity as number|undefined)??0)*((lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0); },0)); },0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">This Month's Logistics</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-xl p-3 bg-purple-50 text-center">
                <p className="text-2xl font-bold text-purple-600">{shipped}</p>
                <p className="text-[10px] text-gray-500">Shipped/Delivered</p>
              </div>
              <div className="rounded-xl p-3 bg-brand/10 text-center">
                <p className="text-2xl font-bold text-brand">{fmtAna(rev,'K',1)}</p>
                <p className="text-[10px] text-gray-500">Revenue</p>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Pending: <strong>{pending}</strong></span>
              <span>Processing: <strong>{processing}</strong></span>
              <span>Total: <strong>{thisMonth.length}</strong></span>
            </div>
          </div>
        );
      })()}
    </>
  );
}
