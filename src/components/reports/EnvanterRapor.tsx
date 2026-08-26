/**
 * EnvanterRapor.tsx — Raporlar > Envanter sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'envanter' sekmesine ait 76 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'envanter'` koşulları BİLEREK korundu: ebeveyn zaten
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
import { KpiCard, KpiGrid, KpiCurrencyToggle } from './ReportKit';

export default function EnvanterRapor(ctx: ReportsCtx) {
  const { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, salesByDate, trendData, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF } = ctx;
  void itemCostTRY; void itemPriceTRY; // sekmeye göre kullanılıyor olabilir
  return (
    <>
      {reportsTab === 'envanter' && (
        <div className="space-y-6">
          {/* KPIs — ortak KpiCard/KpiGrid (ReportKit) ile tek tip */}
          <KpiGrid>
            {([
              { label: currentLanguage==='tr'?'Toplam Ürün':'Total Products', value: String(inventory.length), icon: Package, accent: 'text-blue-600', accentBg: 'bg-blue-50', isMoney: false },
              { label: currentLanguage==='tr'?'Düşük Stok':'Low Stock', value: String(lowStockItems), icon: AlertCircle, accent: 'text-orange-500', accentBg: 'bg-orange-50', isMoney: false },
              { label: currentLanguage==='tr'?'Toplam Stok Değeri':'Total Stock Value', value: formatInCurrency(totalInventoryValueTRY, revenueCurrency, exchangeRates ?? undefined), icon: CreditCard, accent: 'text-green-600', accentBg: 'bg-green-50', isMoney: true },
              { label: currentLanguage==='tr'?'Kategori Sayısı':'Categories', value: String(Object.keys(categoryData).length), icon: List, accent: 'text-purple-600', accentBg: 'bg-purple-50', isMoney: false },
            ] as { label: string; value: string; icon: React.ElementType; accent: string; accentBg: string; isMoney: boolean }[]).map((k,i) => (
              <KpiCard key={i} index={i} label={k.label} value={k.value} icon={k.icon} accent={k.accent} accentBg={k.accentBg}
                action={k.isMoney ? <KpiCurrencyToggle value={revenueCurrency} onChange={setRevenueCurrency} /> : undefined} />
            ))}
          </KpiGrid>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Kategori Stok */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Kategori Bazlı Stok':'Stock by Category'}</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryValueChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F5F5F7" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#86868B'}} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#86868B'}} width={80} />
                    <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 25px rgba(0,0,0,0.1)'}} />
                    <Bar dataKey="count" fill="#007AFF" radius={[0,6,6,0]} name={currentLanguage==='tr'?'Adet':'Units'} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Düşük Stok Listesi */}
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Kritik Stok Ürünleri':'Critical Stock Items'}</h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-sm font-medium">{currentLanguage==='tr'?'Tüm ürünler yeterli stokta':'All products in stock'}</span>
                  </div>
                ) : inventory.filter(i => i.stockLevel <= i.lowStockThreshold).sort((a,b) => a.stockLevel-b.stockLevel).map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-bold text-red-500">{item.stockLevel} {currentLanguage==='tr'?'adet':'units'}</p>
                      <p className="text-[10px] text-gray-400">Min: {item.lowStockThreshold}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tüm Envanter Tablosu */}
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage==='tr'?'Envanter Özeti':'Inventory Summary'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {[
                      {k:'name', label:currentLanguage==='tr'?'Ürün':'Product', align:'text-left', cls:''},
                      {k:'category', label:currentLanguage==='tr'?'Kategori':'Category', align:'text-left', cls:'hidden sm:table-cell'},
                      {k:'stockLevel', label:currentLanguage==='tr'?'Stok':'Stock', align:'text-right', cls:''},
                      {k:'value', label:currentLanguage==='tr'?'Değer':'Value', align:'text-right', cls:'hidden md:table-cell'},
                    ].map(({k,label,align,cls}) => {
                      const active = invSummarySort.key === k;
                      return (
                        <th key={k} onClick={() => setInvSummarySort(s=>({key:k,dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))} className={`${align} py-2 px-3 font-medium text-xs cursor-pointer select-none transition-colors ${cls} ${active?'text-brand':'text-gray-500 hover:text-gray-700'}`}>
                          {label} <span className={active?'opacity-100':'opacity-25'}>{active?(invSummarySort.dir==='asc'?'↑':'↓'):'↕'}</span>
                        </th>
                      );
                    })}
                    <th className="text-center py-2 px-3 text-gray-500 font-medium text-xs">{currentLanguage==='tr'?'Durum':'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...inventory].sort((a,b) => {
                    const av = invSummarySort.key === 'value'
                      ? (a.stockLevel * (a.prices?.['Retail'] || 0))
                      : (a as Record<string,unknown>)[invSummarySort.key] as string|number ?? '';
                    const bv = invSummarySort.key === 'value'
                      ? (b.stockLevel * (b.prices?.['Retail'] || 0))
                      : (b as Record<string,unknown>)[invSummarySort.key] as string|number ?? '';
                    if (av < bv) return invSummarySort.dir === 'asc' ? -1 : 1;
                    if (av > bv) return invSummarySort.dir === 'asc' ? 1 : -1;
                    return 0;
                  }).slice(0,10).map((item, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-3">
                        <p className="font-medium text-gray-800">{item.name}</p>
                        <p className="text-xs text-gray-400">{item.sku}</p>
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs hidden sm:table-cell">{item.category||'—'}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-800">{item.stockLevel}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500 text-xs hidden md:table-cell">{fmtAna(item.stockLevel*(item.prices?.['Retail']||0))}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.stockLevel <= item.lowStockThreshold ? 'bg-red-100 text-red-600' : item.stockLevel <= item.lowStockThreshold*2 ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                          {item.stockLevel <= item.lowStockThreshold ? (currentLanguage==='tr'?'Kritik':'Critical') : item.stockLevel <= item.lowStockThreshold*2 ? (currentLanguage==='tr'?'Düşük':'Low') : (currentLanguage==='tr'?'Normal':'Normal')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inventory.length > 10 && <p className="text-xs text-center text-gray-400 mt-3 py-2">{currentLanguage==='tr'?`+${inventory.length-10} ürün daha — Envanter sekmesine gidin`:`+${inventory.length-10} more items — Go to Inventory tab`}</p>}
            </div>

          {/* ── Phase 135: Product Profitability ── */}
          {orders.length > 0 && inventory.length > 0 && (() => {
            type ProdProfit = { name: string; sku: string; revenue: number; cogs: number; margin: number; units: number };
            const prodMap: Record<string, ProdProfit> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              for (const li of (o.lineItems || [])) {
                const key = li.inventoryId || li.name;
                if (!prodMap[key]) {
                  const inv = inventory.find(i => i.id === li.inventoryId || i.name === li.name);
                  prodMap[key] = { name: li.name, sku: li.sku || inv?.sku || '—', revenue: 0, cogs: 0, margin: 0, units: 0 };
                }
                prodMap[key].revenue += li.price * li.quantity;
                prodMap[key].cogs += ((li.costPrice ?? 0) || 0) * li.quantity;
                prodMap[key].units += li.quantity;
              }
            }
            const prods = Object.values(prodMap)
              .map(p => ({ ...p, margin: p.revenue > 0 ? Math.round(((p.revenue - p.cogs) / p.revenue) * 100) : 0 }))
              .sort((a, b) => b.revenue - a.revenue)
              .slice(0, 10);
            if (prods.length === 0) return null;
            return (
              <div className="apple-card p-6 mt-4">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💰 Ürün Kârlılık Analizi' : '💰 Product Profitability'}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        <th className="text-left py-2 px-3">{currentLanguage === 'tr' ? 'Ürün' : 'Product'}</th>
                        <th className="text-right py-2 px-3">{currentLanguage === 'tr' ? 'Adet' : 'Units'}</th>
                        <th className="text-right py-2 px-3 hidden sm:table-cell">{currentLanguage === 'tr' ? 'Ciro' : 'Revenue'}</th>
                        <th className="text-right py-2 px-3 hidden md:table-cell">{currentLanguage === 'tr' ? 'Maliyet' : 'COGS'}</th>
                        <th className="text-right py-2 px-3">{currentLanguage === 'tr' ? 'Marj' : 'Margin'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {prods.map(p => (
                        <tr key={p.name} className="hover:bg-gray-50/50 transition-all">
                          <td className="py-3 px-3">
                            <p className="text-xs font-bold text-gray-800 truncate max-w-[180px]">{p.name}</p>
                            <p className="text-[9px] text-gray-400">{p.sku}</p>
                          </td>
                          <td className="py-3 px-3 text-right text-xs font-semibold text-gray-600">{p.units}</td>
                          <td className="py-3 px-3 text-right text-xs font-bold text-gray-800 hidden sm:table-cell">{fmtAna(p.revenue)}</td>
                          <td className="py-3 px-3 text-right text-xs text-gray-500 hidden md:table-cell">{fmtAna(p.cogs)}</td>
                          <td className="py-3 px-3 text-right">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.margin >= 30 ? 'bg-emerald-100 text-emerald-700' : p.margin >= 15 ? 'bg-amber-100 text-amber-700' : p.cogs > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                              {p.cogs > 0 ? `%${p.margin}` : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* ── Phase 137: Inventory Valuation by Category ── */}
          {inventory.length > 0 && (() => {
            type CatVal = { category: string; items: number; stockValue: number; costValue: number; margin: number };
            const catMap: Record<string, CatVal> = {};
            for (const item of inventory) {
              const cat = item.category || (currentLanguage === 'tr' ? 'Kategorisiz' : 'Uncategorized');
              if (!catMap[cat]) catMap[cat] = { category: cat, items: 0, stockValue: 0, costValue: 0, margin: 0 };
              const retail = item.prices?.['Retail'] ?? item.price ?? 0;
              const cost = itemCostTRY(item, exchangeRates);
              const qty = item.stockLevel ?? 0;
              catMap[cat].items++;
              catMap[cat].stockValue += retail * qty;
              catMap[cat].costValue += cost * qty;
            }
            const cats = Object.values(catMap).map(c => ({
              ...c, margin: c.stockValue > 0 ? Math.round(((c.stockValue - c.costValue) / c.stockValue) * 100) : 0
            })).sort((a, b) => b.stockValue - a.stockValue);
            const maxVal = Math.max(...cats.map(c => c.stockValue), 1);
            const totalStockVal = cats.reduce((s, c) => s + c.stockValue, 0);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📦 Kategori Bazında Stok Değeri' : '📦 Inventory Valuation by Category'}</h3>
                <div className="space-y-3">
                  {cats.map(c => (
                    <div key={c.category}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-gray-800">{c.category}</p>
                          <span className="text-[9px] text-gray-400">{c.items} {currentLanguage === 'tr' ? 'ürün' : 'items'}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-gray-500">{fmtAna(c.stockValue,'K',1)}</span>
                          {c.costValue > 0 && <span className={`font-bold ${c.margin >= 30 ? 'text-emerald-600' : c.margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>%{c.margin}</span>}
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className="h-2 bg-brand/60 rounded-full transition-all duration-700" style={{ width: `${(c.stockValue / maxVal) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-xs font-bold text-gray-600">
                  <span>{cats.length} {currentLanguage === 'tr' ? 'kategori' : 'categories'}</span>
                  <span>{currentLanguage === 'tr' ? 'Toplam Stok Değeri' : 'Total Stock Value'}: {fmtAna(totalStockVal,'K',1)}</span>
                </div>
              </div>
            );
          })()}

          {/* ── Phase 144: Expiry Date Tracker ── */}
          {(() => {
            const today144 = new Date();
            const in30 = new Date(today144); in30.setDate(in30.getDate() + 30);
            const in90 = new Date(today144); in90.setDate(in90.getDate() + 90);
            const expItems = inventory
              .filter(i => i.expiryDate)
              .map(i => {
                const expDate = new Date(i.expiryDate as string);
                const daysLeft = Math.round((expDate.getTime() - today144.getTime()) / 86400000);
                return { ...i, expDate, daysLeft };
              })
              .sort((a, b) => a.daysLeft - b.daysLeft);
            if (expItems.length === 0) return null;
            const expired = expItems.filter(i => i.daysLeft < 0);
            const critical = expItems.filter(i => i.daysLeft >= 0 && i.daysLeft <= 30);
            const warning = expItems.filter(i => i.daysLeft > 30 && i.daysLeft <= 90);
            return (
              <div className="apple-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Son Kullanma Tarihi Takibi' : '📅 Expiry Date Tracker'}</h3>
                  <div className="flex items-center gap-2 text-xs">
                    {expired.length > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{expired.length} {currentLanguage==='tr'?'süresi geçmiş':'expired'}</span>}
                    {critical.length > 0 && <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">{critical.length} {currentLanguage==='tr'?'kritik':'critical'}</span>}
                    {warning.length > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{warning.length} {currentLanguage==='tr'?'uyarı':'warning'}</span>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Ürün':'Product'}</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">SKU</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Stok':'Stock'}</th>
                        <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Son Kullanma':'Expiry'}</th>
                        <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Kalan Gün':'Days Left'}</th>
                        <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500">{currentLanguage==='tr'?'Durum':'Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {expItems.slice(0, 15).map(item => {
                        const isExpired = item.daysLeft < 0;
                        const isCritical = !isExpired && item.daysLeft <= 30;
                        const isWarn = !isExpired && item.daysLeft > 30 && item.daysLeft <= 90;
                        const badge = isExpired
                          ? { label: currentLanguage==='tr'?'Süresi Geçti':'Expired', cls: 'bg-red-100 text-red-700' }
                          : isCritical
                            ? { label: currentLanguage==='tr'?'Kritik':'Critical', cls: 'bg-orange-100 text-orange-700' }
                            : isWarn
                              ? { label: currentLanguage==='tr'?'Uyarı':'Warning', cls: 'bg-amber-100 text-amber-700' }
                              : { label: currentLanguage==='tr'?'Normal':'OK', cls: 'bg-emerald-100 text-emerald-700' };
                        return (
                          <tr key={item.id} className={`hover:bg-gray-50 ${isExpired ? 'bg-red-50/40' : ''}`}>
                            <td className="py-2.5 px-3 font-medium text-gray-900">{item.name}</td>
                            <td className="py-2.5 px-3 font-mono text-xs text-gray-500">{item.sku}</td>
                            <td className="py-2.5 px-3 text-right text-gray-700">{item.stockLevel}</td>
                            <td className="py-2.5 px-3 text-center text-xs text-gray-600">{item.expDate.toLocaleDateString()}</td>
                            <td className={`py-2.5 px-3 text-center font-bold text-sm ${isExpired ? 'text-red-600' : isCritical ? 'text-orange-600' : isWarn ? 'text-amber-600' : 'text-emerald-600'}`}>
                              {isExpired ? `+${Math.abs(item.daysLeft)}` : item.daysLeft}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* ── Phase 151: SKU Velocity Ranking ── */}
          {(() => {
            // Count units sold per SKU across all non-cancelled orders
            const skuMap: Record<string, { name: string; sku: string; unitsSold: number; revenue: number; category: string }> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              for (const li of (o.lineItems || [])) {
                const key = li.sku || li.name;
                if (!skuMap[key]) {
                  const inv = inventory.find(i => i.sku === li.sku || i.name === li.name);
                  skuMap[key] = { name: li.name, sku: li.sku || key, unitsSold: 0, revenue: 0, category: inv?.category || '—' };
                }
                skuMap[key].unitsSold += li.quantity;
                skuMap[key].revenue += li.price * li.quantity;
              }
            }
            const skus = Object.values(skuMap).sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 12);
            if (skus.length === 0) return null;
            const maxUnits = Math.max(...skus.map(s => s.unitsSold), 1);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🚀 SKU Hız Sıralaması' : '🚀 SKU Velocity Ranking'}</h3>
                <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'En çok satılan ürünler (adet bazında)' : 'Top products by units sold'}</p>
                <div className="space-y-2">
                  {skus.map((s, i) => {
                    const w = Math.round((s.unitsSold / maxUnits) * 100);
                    const tier = i < 3 ? 'A' : i < 7 ? 'B' : 'C';
                    const tierCls = tier === 'A' ? 'bg-emerald-100 text-emerald-700' : tier === 'B' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600';
                    return (
                      <div key={s.sku} className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${tierCls} shrink-0 w-6 text-center`}>{tier}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-medium text-gray-800 truncate">{s.name}</span>
                            <span className="text-xs text-gray-500 ml-2 shrink-0 tabular-nums">{s.unitsSold} {currentLanguage==='tr'?'adet':'units'}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${tier === 'A' ? 'bg-emerald-400' : tier === 'B' ? 'bg-blue-400' : 'bg-gray-300'}`} style={{ width: `${w}%` }} />
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 shrink-0 tabular-nums w-20 text-right">{fmtAna(s.revenue,'full',0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 176: Inventory Turnover by Category ── */}
          {inventory.length > 0 && orders.length > 0 && (() => {
            const catMap: Record<string, { totalCOGS: number; avgStock: number; turnover: number }> = {};
            for (const i of inventory) {
              const cat = i.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other'); // parantez: önce tüm kategoriler 'Diğer'e çöküyordu
              if (!catMap[cat]) catMap[cat] = { totalCOGS: 0, avgStock: 0, turnover: 0 };
              catMap[cat].avgStock += (i.stockLevel ?? 0) * itemCostTRY(i, exchangeRates);
            }
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              for (const li of (o.lineItems || [])) {
                const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
                const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
                if (!catMap[cat]) catMap[cat] = { totalCOGS: 0, avgStock: 0, turnover: 0 };
                catMap[cat].totalCOGS += (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
              }
            }
            const cats = Object.entries(catMap)
              .map(([cat, v]) => ({
                cat,
                turnover: v.avgStock > 0 ? parseFloat((v.totalCOGS / v.avgStock).toFixed(2)) : 0,
                avgStock: v.avgStock,
              }))
              .filter(c => c.avgStock > 0)
              .sort((a, b) => b.turnover - a.turnover)
              .slice(0, 8);
            if (cats.length === 0) return null;
            const maxTurnover = Math.max(...cats.map(c => c.turnover), 1);
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🔄 Kategori Bazlı Stok Devir Hızı' : '🔄 Inventory Turnover by Category'}</h3>
                <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'COGS / Ortalama stok değeri' : 'COGS / Average stock value'}</p>
                <div className="space-y-2.5">
                  {cats.map(c => {
                    const w = Math.round((c.turnover / maxTurnover) * 100);
                    return (
                      <div key={c.cat} className="flex items-center gap-3">
                        <span className="text-xs text-gray-700 w-28 shrink-0 truncate">{c.cat}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${c.turnover >= 6 ? 'bg-emerald-400' : c.turnover >= 3 ? 'bg-blue-400' : 'bg-amber-400'}`} style={{ width: `${w}%` }} />
                        </div>
                        <span className={`text-xs font-bold tabular-nums shrink-0 w-10 text-right ${c.turnover >= 6 ? 'text-emerald-600' : c.turnover >= 3 ? 'text-blue-600' : 'text-amber-600'}`}>{c.turnover}x</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── Phase 177: Price Tier Revenue Distribution ── */}
          {orders.length > 0 && (() => {
            const tierMap: Record<string, { revenue: number; orders: number }> = {};
            for (const o of orders) {
              if (o.status === 'Cancelled') continue;
              const tier = (o as unknown as Record<string,unknown>).customerType as string || o.customerType || 'Retail';
              if (!tierMap[tier]) tierMap[tier] = { revenue: 0, orders: 0 };
              tierMap[tier].revenue += o.totalPrice || 0;
              tierMap[tier].orders++;
            }
            const tiers = Object.entries(tierMap).sort(([,a],[,b]) => b.revenue - a.revenue);
            if (tiers.length < 2) return null;
            const total177 = tiers.reduce((s, [,v]) => s + v.revenue, 0);
            const tierColors: Record<string, string> = { 'B2B': '#3b82f6', 'Retail': '#10b981', 'Dealer': '#f59e0b', 'B2B Premium': '#8b5cf6', 'B2B Standard': '#06b6d4' };
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💰 Fiyat Kademesi Gelir Dağılımı' : '💰 Price Tier Revenue Mix'}</h3>
                <div className="flex rounded-xl overflow-hidden h-6 mb-4 gap-0.5">
                  {tiers.map(([tier, v]) => (
                    <div key={tier} className="transition-all" style={{ width: `${Math.round((v.revenue / total177) * 100)}%`, backgroundColor: tierColors[tier] || '#6b7280' }} title={`${tier}: ₺${v.revenue.toLocaleString()}`} />
                  ))}
                </div>
                <div className="space-y-1.5">
                  {tiers.map(([tier, v]) => (
                    <div key={tier} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: tierColors[tier] || '#6b7280' }} />
                        <span className="text-gray-700">{tier}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400">{Math.round((v.revenue / total177) * 100)}%</span>
                        <span className="font-bold text-gray-800 tabular-nums">{fmtAna(v.revenue,'K',1)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          </div>
        </div>
      )}

      {reportsTab === 'envanter' && orders.length >= 3 && (() => {
        // Find most common item pairs within the same order
        const pairMap: Record<string, { nameA: string; nameB: string; count: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const items = (o.lineItems || []).map(li => li.name).filter(Boolean);
          if (items.length < 2) continue;
          for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
              const key = [items[i], items[j]].sort().join('|||');
              if (!pairMap[key]) pairMap[key] = { nameA: items[i], nameB: items[j], count: 0 };
              pairMap[key].count++;
            }
          }
        }
        const pairs = Object.values(pairMap).filter(p => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);
        if (pairs.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? '🛒 Birlikte Sık Satın Alınan Ürünler' : '🛒 Frequently Bought Together'}</h3>
            <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Aynı siparişte en çok birlikte geçen ürün çiftleri' : 'Most common product pairs in the same order'}</p>
            <div className="space-y-2.5">
              {pairs.map((p, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded-md shrink-0">×{p.count}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-800 truncate">{p.nameA}</span>
                    <span className="text-gray-300 shrink-0">+</span>
                    <span className="text-xs font-medium text-gray-800 truncate">{p.nameB}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length > 0 && (() => {
        // Find items with negative adjustments (shrinkage/write-offs)
        type ShrinkItem = { name: string; qty: number; value: number };
        const shrinkMap: Record<string, ShrinkItem> = {};
        for (const mov of inventoryMovements) {
          const m = mov as unknown as Record<string, unknown>;
          const type = (m.type as string) || '';
          const qty = (m.quantity as number) || 0;
          const isNeg = type === 'adjustment' && qty < 0;
          const isWriteOff = type === 'write-off' || type === 'damage' || type === 'loss';
          if (!isNeg && !isWriteOff) continue;
          const pid = (m.productId as string) || (m.inventoryId as string) || '';
          const inv = inventory.find(i => i.id === pid || i.name === (m.productName as string));
          const name = inv?.name || (m.productName as string) || pid || '—';
          if (!shrinkMap[name]) shrinkMap[name] = { name, qty: 0, value: 0 };
          shrinkMap[name].qty += Math.abs(qty);
          shrinkMap[name].value += Math.abs(qty) * (inv ? itemCostTRY(inv, exchangeRates) : 0);
        }
        const shrinkItems = Object.values(shrinkMap).sort((a, b) => b.value - a.value).slice(0, 8);
        if (shrinkItems.length === 0) return null;
        const totalShrinkVal = shrinkItems.reduce((s, i) => s + i.value, 0);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📉 Fire & Kayıp Raporu' : '📉 Inventory Shrinkage Report'}</h3>
              <span className="text-xs text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded-full">
                {fmtAna(totalShrinkVal,'full',0)} {currentLanguage==='tr'?'toplam kayıp':'total loss'}
              </span>
            </div>
            <div className="space-y-2.5">
              {shrinkItems.map(item => (
                <div key={item.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-medium text-gray-800 truncate">{item.name}</span>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-xs text-gray-500">{item.qty} {currentLanguage==='tr'?'adet':'units'}</span>
                    <span className="text-xs font-bold text-red-500">-{fmtAna(item.value,'full',0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 3 && inventory.length > 0 && (() => {
        const now182 = new Date();
        const cats182 = [...new Set(inventory.map(i => i.category).filter(Boolean))].slice(0, 5) as string[];
        if (cats182.length < 2) return null;
        const months182 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now182.getFullYear(), now182.getMonth() - (5 - i), 1);
          return {
            label: d.toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }),
            year: d.getFullYear(), month: d.getMonth(),
          };
        });
        // Build margin[cat][monthIdx]
        const heatmap: Record<string, number[]> = {};
        for (const c of cats182) heatmap[c] = Array(6).fill(null);
        for (let mi = 0; mi < months182.length; mi++) {
          const { year, month } = months182[mi];
          const mOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === year && od.getMonth() === month;
            } catch { return false; }
          });
          for (const c of cats182) {
            let rev = 0; let cogs = 0;
            for (const o of mOrders) {
              for (const li of (o.lineItems ?? [])) {
                const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
                if (!inv || inv.category !== c) continue;
                rev += li.price * li.quantity;
                cogs += itemCostTRY(inv, exchangeRates) * li.quantity;
              }
            }
            heatmap[c][mi] = rev > 0 ? Math.round(((rev - cogs) / rev) * 100) : -1;
          }
        }
        const cellColor = (m: number) => {
          if (m < 0) return 'bg-gray-50 text-gray-300';
          if (m >= 40) return 'bg-emerald-600 text-white';
          if (m >= 25) return 'bg-emerald-400 text-white';
          if (m >= 15) return 'bg-amber-300 text-gray-800';
          if (m >= 0) return 'bg-red-300 text-gray-800';
          return 'bg-gray-100 text-gray-400';
        };
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🟩 Brüt Marj Isı Haritası (Kategori × Ay)' : '🟩 Gross Margin Heatmap (Category × Month)'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-gray-500 font-medium pb-2 pr-3">{currentLanguage === 'tr' ? 'Kategori' : 'Category'}</th>
                    {months182.map(m => <th key={m.label} className="text-center text-gray-500 font-medium pb-2 px-1 min-w-[44px]">{m.label}</th>)}
                  </tr>
                </thead>
                <tbody className="space-y-1">
                  {cats182.map(c => (
                    <tr key={c}>
                      <td className="text-gray-700 font-medium py-1 pr-3 truncate max-w-[100px]">{c}</td>
                      {heatmap[c].map((val, mi) => (
                        <td key={mi} className="py-1 px-0.5 text-center">
                          <span className={`inline-block rounded-md px-1.5 py-1 font-bold text-[10px] w-full ${cellColor(val)}`}>
                            {val >= 0 ? `%${val}` : '—'}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {[
                { cls: 'bg-emerald-600', label: '≥40%' },
                { cls: 'bg-emerald-400', label: '25-40%' },
                { cls: 'bg-amber-300', label: '15-25%' },
                { cls: 'bg-red-300', label: '<15%' },
                { cls: 'bg-gray-50 border border-gray-200', label: currentLanguage === 'tr' ? 'Veri yok' : 'No data' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1">
                  <span className={`w-3 h-3 rounded-sm ${l.cls}`} />
                  <span className="text-[10px] text-gray-500">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && (() => {
        const suppMap183: Record<string, { value: number; items: number }> = {};
        for (const item of inventory) {
          const supp = item.supplier?.trim() || (currentLanguage === 'tr' ? 'Bilinmiyor' : 'Unknown');
          const val = itemCostTRY(item, exchangeRates) * (item.stockLevel ?? 0);
          if (!suppMap183[supp]) suppMap183[supp] = { value: 0, items: 0 };
          suppMap183[supp].value += val;
          suppMap183[supp].items++;
        }
        const suppList183 = Object.entries(suppMap183)
          .map(([name, d]) => ({ name, ...d }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8);
        if (suppList183.length < 2) return null;
        const totalVal183 = suppList183.reduce((s, s2) => s + s2.value, 0);
        const top1Pct = totalVal183 > 0 ? Math.round((suppList183[0].value / totalVal183) * 100) : 0;
        const top3Pct = totalVal183 > 0 ? Math.round((suppList183.slice(0, 3).reduce((s, s2) => s + s2.value, 0) / totalVal183) * 100) : 0;
        const riskLevel = top1Pct >= 60 ? 'high' : top1Pct >= 40 ? 'medium' : 'low';
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔗 Tedarikçi Konsantrasyon Riski' : '🔗 Supplier Concentration Risk'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${riskLevel === 'high' ? 'bg-red-100 text-red-700' : riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {riskLevel === 'high' ? (currentLanguage === 'tr' ? 'Yüksek Risk' : 'High Risk') : riskLevel === 'medium' ? (currentLanguage === 'tr' ? 'Orta Risk' : 'Med Risk') : (currentLanguage === 'tr' ? 'Düşük Risk' : 'Low Risk')}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Stok değerine göre tedarikçi dağılımı' : 'Supplier distribution by inventory value'}</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-black ${top1Pct >= 60 ? 'text-red-500' : top1Pct >= 40 ? 'text-amber-500' : 'text-emerald-600'}`}>%{top1Pct}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'En büyük tedarikçi' : 'Top supplier share'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-black ${top3Pct >= 80 ? 'text-amber-500' : 'text-blue-600'}`}>%{top3Pct}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'İlk 3 tedarikçi' : 'Top 3 suppliers'}</p>
              </div>
            </div>
            <div className="space-y-2">
              {suppList183.map(s => {
                const pct = totalVal183 > 0 ? Math.round((s.value / totalVal183) * 100) : 0;
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700 truncate">{s.name}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{s.items} {currentLanguage === 'tr' ? 'ürün' : 'items'}</span>
                        <span className="text-xs font-bold text-gray-700">%{pct}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 40 ? 'bg-red-400' : pct >= 20 ? 'bg-amber-400' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {top1Pct >= 40 && (
              <div className="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                <p className="text-xs text-amber-700 font-medium">⚠️ {currentLanguage === 'tr' ? `"${suppList183[0].name}" tedarikçisi stok değerinin %${top1Pct}'ini oluşturuyor. Tedarik riski yüksek.` : `"${suppList183[0].name}" accounts for ${top1Pct}% of inventory value — high supply chain risk.`}</p>
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length > 0 && (() => {
        // Group return/adjustment movements per product
        const returnMap: Record<string, { name: string; returns: number; totalSold: number }> = {};
        for (const mov of inventoryMovements) {
          const m = mov as unknown as Record<string, unknown>;
          const type = (m.type as string) || '';
          if (!['return', 'sale-return', 'customer-return'].includes(type)) continue;
          const pid = (m.productId as string) || (m.inventoryId as string) || '';
          const inv = inventory.find(i => i.id === pid || i.name === (m.productName as string));
          const name = inv?.name || (m.productName as string) || pid || '?';
          if (!returnMap[name]) returnMap[name] = { name, returns: 0, totalSold: 0 };
          returnMap[name].returns += Math.abs((m.quantity as number) || 0);
        }
        // Total sold from sale movements
        for (const mov of inventoryMovements) {
          const m = mov as unknown as Record<string, unknown>;
          const type = (m.type as string) || '';
          if (type !== 'sale' && type !== 'out') continue;
          const pid = (m.productId as string) || (m.inventoryId as string) || '';
          const inv = inventory.find(i => i.id === pid || i.name === (m.productName as string));
          const name = inv?.name || (m.productName as string) || pid || '?';
          if (returnMap[name]) returnMap[name].totalSold += Math.abs((m.quantity as number) || 0);
        }
        const returnItems = Object.values(returnMap)
          .filter(r => r.returns > 0)
          .map(r => ({ ...r, rate: r.totalSold > 0 ? Math.round((r.returns / r.totalSold) * 100) : null }))
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
          .slice(0, 6);
        if (returnItems.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '↩️ Ürün İade Oranı' : '↩️ Product Return Rate'}</h3>
            <div className="space-y-2.5">
              {returnItems.map(item => (
                <div key={item.name} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-medium text-gray-800 truncate">{item.name}</span>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-[10px] text-gray-500">{item.returns} {currentLanguage === 'tr' ? 'iade' : 'returns'}</span>
                    {item.rate !== null ? (
                      <span className={`text-xs font-bold ${item.rate >= 20 ? 'text-red-500' : item.rate >= 10 ? 'text-amber-500' : 'text-gray-600'}`}>%{item.rate}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'İade/Satış oranı — %10+ yüksek risk' : 'Return/Sales ratio — 10%+ is high risk'}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && orders.length >= 3 && (() => {
        // Compute revenue per product
        const prodRev: Record<string, { name: string; rev: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const key = li.inventoryId || li.name || li.sku || '?';
            const name = li.name || key;
            if (!prodRev[key]) prodRev[key] = { name, rev: 0 };
            prodRev[key].rev += li.price * li.quantity;
          }
        }
        const sorted = Object.values(prodRev).sort((a, b) => b.rev - a.rev);
        if (sorted.length < 3) return null;
        const totalRev191 = sorted.reduce((s, p) => s + p.rev, 0);
        let cumRev = 0;
        const withClass = sorted.map(p => {
          cumRev += p.rev;
          const cumPct = totalRev191 > 0 ? (cumRev / totalRev191) * 100 : 0;
          const cls = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
          return { ...p, cls, pct: totalRev191 > 0 ? Math.round((p.rev / totalRev191) * 100) : 0 };
        });
        const counts = { A: withClass.filter(p => p.cls === 'A').length, B: withClass.filter(p => p.cls === 'B').length, C: withClass.filter(p => p.cls === 'C').length };
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🅰️ Stok ABC Analizi' : '🅰️ Inventory ABC Analysis'}</h3>
              <div className="flex items-center gap-1.5">
                {(['A','B','C'] as const).map(c => (
                  <span key={c} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c === 'A' ? 'bg-emerald-100 text-emerald-700' : c === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{c}: {counts[c]}</span>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {withClass.slice(0, 15).map((p, i) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded text-[10px] font-black flex items-center justify-center shrink-0 ${p.cls === 'A' ? 'bg-emerald-500 text-white' : p.cls === 'B' ? 'bg-amber-400 text-white' : 'bg-gray-300 text-gray-700'}`}>{p.cls}</span>
                  <span className="text-[10px] text-gray-400 w-5 shrink-0">#{i+1}</span>
                  <span className="text-xs text-gray-700 truncate flex-1">{p.name}</span>
                  <span className="text-xs font-bold text-gray-700 shrink-0">%{p.pct}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'A=Cironun %80\'i, B=%15, C=%5. Satış gelirine göre sınıflandırma.' : 'A=80% of revenue, B=15%, C=5%. Classified by sales revenue.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 10 && (() => {
        const now194 = new Date();
        const thisMonth = now194.getMonth();
        const currYear = now194.getFullYear();
        const prevYear = currYear - 1;
        // Compare last 6 months this year vs same months last year
        const periods = Array.from({ length: 6 }, (_, i) => {
          const month = (thisMonth - 5 + i + 12) % 12;
          const cYear = thisMonth - 5 + i < 0 ? currYear - 1 : currYear;
          const pYear = cYear - 1;
          const label = new Date(cYear, month, 1).toLocaleDateString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' });
          const curr = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === cYear && od.getMonth() === month;
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          const prev = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              return od.getFullYear() === pYear && od.getMonth() === month;
            } catch { return false; }
          }).reduce((s, o) => s + (o.totalPrice || 0), 0);
          return { label, curr, prev, yoy: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null };
        });
        const hasPrevYear = periods.some(p => p.prev > 0);
        if (!hasPrevYear) return null;
        const maxVal = Math.max(...periods.map(p => Math.max(p.curr, p.prev)), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Yıllık Mevsimsel Karşılaştırma' : '📅 Year-over-Year Seasonal'}</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-blue-400" /><span className="text-[10px] text-gray-500">{currYear}</span></div>
                <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-gray-300" /><span className="text-[10px] text-gray-500">{prevYear}</span></div>
              </div>
            </div>
            <div className="flex items-end gap-2 h-28 mb-2">
              {periods.map((p, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full flex items-end gap-0.5" style={{ height: '80px' }}>
                    <div className="flex-1 bg-blue-400 rounded-t-sm" style={{ height: `${Math.max(2, Math.round((p.curr / maxVal) * 80))}px` }} />
                    <div className="flex-1 bg-gray-200 rounded-t-sm" style={{ height: `${Math.max(2, Math.round((p.prev / maxVal) * 80))}px` }} />
                  </div>
                  <span className="text-[8px] text-gray-400 leading-none">{p.label}</span>
                  {p.yoy !== null && (
                    <span className={`text-[8px] font-bold leading-none ${p.yoy >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{p.yoy >= 0 ? '+' : ''}{p.yoy}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && orders.length > 0 && (() => {
        const now199 = new Date();
        const cutoff199 = new Date(now199); cutoff199.setDate(cutoff199.getDate() - 60);
        // Products sold in last 60 days
        const soldRecently = new Set<string>();
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff199) continue;
            for (const li of (o.lineItems ?? [])) {
              soldRecently.add(li.inventoryId || li.name || li.sku || '');
            }
          } catch { /* skip */ }
        }
        const deadStock = inventory.filter(i =>
          (i.stockLevel ?? 0) > 0 &&
          !soldRecently.has(i.id) &&
          !soldRecently.has(i.name) &&
          !soldRecently.has(i.sku || '')
        ).map(i => ({
          name: i.name,
          stock: i.stockLevel ?? 0,
          value: (i.stockLevel ?? 0) * itemCostTRY(i, exchangeRates),
          category: i.category ?? '—',
        })).sort((a, b) => b.value - a.value).slice(0, 8);
        if (deadStock.length === 0) return null;
        const totalDeadVal = deadStock.reduce((s, i) => s + i.value, 0);
        return (
          <div className="apple-card p-6 border border-orange-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💤 Ölü Stok Alarmı (60 Gün Satışsız)' : '💤 Dead Stock Alert (60 Days No Sales)'}</h3>
              <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                {fmtAna(totalDeadVal,'K',0)} {currentLanguage === 'tr' ? 'hareketsiz' : 'idle'}
              </span>
            </div>
            <div className="space-y-2">
              {deadStock.map(item => (
                <div key={item.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-gray-800">{item.name}</p>
                    <p className="text-[10px] text-gray-400">{item.category} · {item.stock} {currentLanguage === 'tr' ? 'adet' : 'units'}</p>
                  </div>
                  <span className="text-xs font-bold text-orange-600 shrink-0 ml-2">{fmtAna(item.value,'full',0)}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Son 60 günde satış hareketi olmayan ve stoku bulunan ürünler.' : 'Items with stock but no sales movement in last 60 days.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && orders.length >= 5 && (() => {
        const now201 = new Date();
        const days201 = 30;
        const cutoff201 = new Date(now201); cutoff201.setDate(cutoff201.getDate() - days201);
        const LEAD_TIME_DAYS = 7;
        // Daily demand per product
        const dailyDemand: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff201) continue;
            for (const li of (o.lineItems ?? [])) {
              const key = li.inventoryId || li.name || '';
              if (!key) continue;
              dailyDemand[key] = (dailyDemand[key] ?? 0) + li.quantity / days201;
            }
          } catch { /* skip */ }
        }
        const reorderItems = inventory
          .map(i => {
            const demand = dailyDemand[i.id] ?? dailyDemand[i.name] ?? dailyDemand[i.sku || ''] ?? 0;
            if (demand <= 0) return null;
            const reorderPoint = Math.ceil(demand * LEAD_TIME_DAYS * 1.5); // 1.5x safety stock
            const needsReorder = (i.stockLevel ?? 0) <= reorderPoint;
            return { name: i.name, stock: i.stockLevel ?? 0, reorderPoint, demand: Math.round(demand * 10) / 10, needsReorder };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => (b.needsReorder ? 1 : 0) - (a.needsReorder ? 1 : 0) || b.demand - a.demand)
          .slice(0, 8);
        if (reorderItems.length === 0) return null;
        const needsReorderCount = reorderItems.filter(i => i.needsReorder).length;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📦 Yeniden Sipariş Noktası Hesaplayıcı' : '📦 Reorder Point Calculator'}</h3>
              {needsReorderCount > 0 && (
                <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {needsReorderCount} {currentLanguage === 'tr' ? 'ürün sipariş gerekiyor' : 'items need reorder'}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 text-[10px]">
                    <th className="text-left pb-2">{currentLanguage === 'tr' ? 'Ürün' : 'Product'}</th>
                    <th className="text-center pb-2">{currentLanguage === 'tr' ? 'Stok' : 'Stock'}</th>
                    <th className="text-center pb-2">{currentLanguage === 'tr' ? 'Yeni. Noktası' : 'Reorder Pt'}</th>
                    <th className="text-center pb-2">{currentLanguage === 'tr' ? 'Günlük Talep' : 'Daily Demand'}</th>
                    <th className="text-center pb-2">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {reorderItems.map(item => (
                    <tr key={item.name} className="border-t border-gray-50">
                      <td className="py-1.5 text-gray-800 font-medium truncate max-w-[100px]">{item.name}</td>
                      <td className="py-1.5 text-center text-gray-700">{item.stock}</td>
                      <td className="py-1.5 text-center text-gray-700">{item.reorderPoint}</td>
                      <td className="py-1.5 text-center text-gray-600">{item.demand}/d</td>
                      <td className="py-1.5 text-center">
                        {item.needsReorder
                          ? <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">🔴 {currentLanguage === 'tr' ? 'Sipariş Ver' : 'Order Now'}</span>
                          : <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">✅ OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? `Yeniden sipariş noktası = Günlük ortalama talep × ${LEAD_TIME_DAYS} gün tedarik süresi × 1.5 emniyet stoku` : `Reorder point = Avg daily demand × ${LEAD_TIME_DAYS}-day lead time × 1.5 safety stock`}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && orders.length >= 5 && (() => {
        const now204 = new Date();
        const days204 = 30;
        const cutoff204 = new Date(now204); cutoff204.setDate(cutoff204.getDate() - days204);
        const unitsSold: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff204) continue;
            for (const li of (o.lineItems ?? [])) {
              const key = li.inventoryId || li.name || '';
              if (!key) continue;
              unitsSold[key] = (unitsSold[key] ?? 0) + li.quantity;
            }
          } catch { /* skip */ }
        }
        const velocityList = inventory
          .map(i => {
            const sold = unitsSold[i.id] ?? unitsSold[i.name] ?? unitsSold[i.sku || ''] ?? 0;
            const stock = i.stockLevel ?? 0;
            const turnover = stock > 0 ? Math.round((sold / stock) * 100) / 100 : sold > 0 ? Infinity : 0;
            return { name: i.name, sold, stock, turnover };
          })
          .filter(i => i.sold > 0 || i.stock > 0)
          .sort((a, b) => b.turnover - a.turnover)
          .slice(0, 10);
        if (velocityList.length < 3) return null;
        const maxTurnover = Math.min(Math.max(...velocityList.map(i => i.turnover === Infinity ? 0 : i.turnover), 1), 5);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⚡ Stok Devir Hızı (Son 30 Gün)' : '⚡ Inventory Velocity (Last 30 Days)'}</h3>
              <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Satılan/Stok Oranı' : 'Units Sold/Stock Ratio'}</span>
            </div>
            <div className="space-y-2">
              {velocityList.map(item => {
                const pct = item.turnover === Infinity ? 100 : Math.min(100, Math.round((item.turnover / maxTurnover) * 100));
                const isfast = item.turnover >= 0.5;
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-gray-700 truncate">{item.name}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{item.sold} {currentLanguage === 'tr' ? 'satılan' : 'sold'}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isfast ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {isfast ? (currentLanguage === 'tr' ? '⚡ Hızlı' : '⚡ Fast') : (currentLanguage === 'tr' ? '🐢 Yavaş' : '🐢 Slow')}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isfast ? 'bg-emerald-400' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 3 && inventory.length > 0 && (() => {
        const catRev206: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
            catRev206[cat] = (catRev206[cat] ?? 0) + li.price * li.quantity;
          }
        }
        const sortedCats = Object.entries(catRev206).sort(([,a],[,b]) => b - a);
        if (sortedCats.length < 2) return null;
        const totalCatRev = sortedCats.reduce((s,[,v]) => s + v, 0);
        let cumPct = 0;
        const withPareto = sortedCats.map(([cat, rev]) => {
          cumPct += totalCatRev > 0 ? (rev / totalCatRev) * 100 : 0;
          return { cat, rev, pct: Math.round((rev / (totalCatRev || 1)) * 100), cumPct: Math.round(cumPct) };
        }).slice(0, 8);
        const maxRev206 = sortedCats[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📊 Kategori Pareto Analizi' : '📊 Category Revenue Pareto'}</h3>
            <div className="space-y-2.5">
              {withPareto.map(c => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.cat}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">%{c.pct}</span>
                      <span className="text-[10px] text-purple-600 font-bold">Σ%{c.cumPct}</span>
                      <span className="text-xs font-bold text-gray-700">{fmtAna(c.rev,'K',0)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.cumPct <= 80 ? 'bg-brand' : c.cumPct <= 95 ? 'bg-amber-400' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, Math.round((c.rev / maxRev206) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-brand inline-block" /> {currentLanguage === 'tr' ? 'Cironun %80\'i' : '80% of Revenue'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> {currentLanguage === 'tr' ? '%80-95' : '80-95%'}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Count how many orders use each price tier (Retail, B2B Standard, B2B Premium, Dealer)
        const tierCounts: Record<string, { count: number; rev: number }> = {
          'Retail': { count: 0, rev: 0 },
          'B2B Standard': { count: 0, rev: 0 },
          'B2B Premium': { count: 0, rev: 0 },
          'Dealer': { count: 0, rev: 0 },
        };
        let matchedOrders = 0;
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const m = o as unknown as Record<string,unknown>;
          const tier = (m.priceTier as string) || (m.priceList as string) || '';
          if (tier && tierCounts[tier]) {
            tierCounts[tier].count++;
            tierCounts[tier].rev += o.totalPrice || 0;
            matchedOrders++;
          }
        }
        if (matchedOrders < 3) return null;
        const total211 = Object.values(tierCounts).reduce((s, t) => s + t.count, 0);
        const tierList = Object.entries(tierCounts).filter(([,t]) => t.count > 0).sort(([,a],[,b]) => b.rev - a.rev);
        if (tierList.length < 2) return null;
        const colors: Record<string, string> = { 'Retail': 'bg-blue-400', 'B2B Standard': 'bg-emerald-400', 'B2B Premium': 'bg-purple-400', 'Dealer': 'bg-amber-400' };
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💲 Fiyat Kademesi Dağılımı' : '💲 Price Tier Adoption'}</h3>
            <div className="space-y-2.5">
              {tierList.map(([tier, d]) => {
                const pct = total211 > 0 ? Math.round((d.count / total211) * 100) : 0;
                return (
                  <div key={tier}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-gray-700">{tier}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{d.count} {currentLanguage === 'tr' ? 'sipariş' : 'orders'} · %{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(d.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${colors[tier] ?? 'bg-gray-400'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && (() => {
        const now219 = new Date();
        const warn30 = new Date(now219); warn30.setDate(warn30.getDate() + 30);
        const warn90 = new Date(now219); warn90.setDate(warn90.getDate() + 90);
        const expiryItems = inventory
          .filter(i => i.expiryDate)
          .map(i => {
            const exp = new Date(i.expiryDate!);
            const daysLeft = Math.round((exp.getTime() - now219.getTime()) / 86400000);
            return { name: i.name, daysLeft, stock: i.stockLevel ?? 0, value: (i.stockLevel ?? 0) * itemCostTRY(i, exchangeRates) };
          })
          .filter(i => i.daysLeft <= 90)
          .sort((a, b) => a.daysLeft - b.daysLeft)
          .slice(0, 8);
        if (expiryItems.length === 0) return null;
        return (
          <div className="apple-card p-6 border border-orange-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏰ Son Kullanma Tarihi Takibi' : '⏰ Expiry Date Tracker'}</h3>
              <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">{expiryItems.length} {currentLanguage === 'tr' ? 'ürün dikkat' : 'items at risk'}</span>
            </div>
            <div className="space-y-2">
              {expiryItems.map(item => (
                <div key={item.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-gray-800">{item.name}</p>
                    <p className="text-[10px] text-gray-400">{item.stock} {currentLanguage === 'tr' ? 'adet' : 'units'} · {fmtAna(item.value,'full',0)}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${item.daysLeft <= 0 ? 'bg-red-200 text-red-800' : item.daysLeft <= 30 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {item.daysLeft <= 0 ? (currentLanguage === 'tr' ? 'Süresi Doldu' : 'Expired') : `${item.daysLeft}d`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && orders.length >= 3 && (() => {
        const now227 = new Date();
        const days227 = 90;
        const cutoff227 = new Date(now227); cutoff227.setDate(cutoff227.getDate() - days227);
        const catSales: Record<string, number> = {};
        const catCost: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff227) continue;
            for (const li of (o.lineItems ?? [])) {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
              catSales[cat] = (catSales[cat] ?? 0) + (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity;
            }
          } catch { /* skip */ }
        }
        for (const i of inventory) {
          const cat = i.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
          catCost[cat] = (catCost[cat] ?? 0) + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0);
        }
        const cats227 = Object.keys({ ...catSales, ...catCost });
        const turnoverList = cats227
          .map(cat => {
            const cogs = catSales[cat] ?? 0;
            const avgInv = catCost[cat] ?? 0;
            const annualCOGS = avgInv > 0 ? (cogs / days227) * 365 : 0;
            const turnover = avgInv > 0 ? Math.round((annualCOGS / avgInv) * 10) / 10 : 0;
            return { cat, turnover, cogs, avgInv };
          })
          .filter(c => c.turnover > 0 || c.avgInv > 0)
          .sort((a, b) => b.turnover - a.turnover)
          .slice(0, 7);
        if (turnoverList.length < 2) return null;
        const maxTurnover227 = Math.max(...turnoverList.map(c => c.turnover), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '🔄 Kategoriye Göre Stok Devir Hızı (Yıllık)' : '🔄 Inventory Turnover by Category (Annual)'}</h3>
            <div className="space-y-2.5">
              {turnoverList.map(c => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.cat}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{fmtAna(c.avgInv,'K',0)} stok</span>
                      <span className={`text-sm font-black ${c.turnover >= 6 ? 'text-emerald-600' : c.turnover >= 3 ? 'text-amber-600' : 'text-red-500'}`}>{c.turnover}×</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.turnover >= 6 ? 'bg-emerald-400' : c.turnover >= 3 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${Math.max(4, Math.round((c.turnover / maxTurnover227) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Benchmark: ≥6× iyi, 3-6× orta, <3× yavaş stok devri (B2B)' : 'Benchmark: ≥6× good, 3-6× average, <3× slow (B2B)'}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 5 && inventory.length > 0 && (() => {
        // Compare avg selling price vs list price per product to gauge price sensitivity
        const prodPricing: Record<string, { listPrice: number; totalRev: number; totalQty: number; name: string }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            if (!inv) continue;
            const key = inv.id;
            const listP = inv.prices?.['Retail'] ?? inv.price ?? li.price;
            if (!prodPricing[key]) prodPricing[key] = { listPrice: listP, totalRev: 0, totalQty: 0, name: inv.name };
            prodPricing[key].totalRev += li.price * li.quantity;
            prodPricing[key].totalQty += li.quantity;
          }
        }
        const pricingList = Object.values(prodPricing)
          .filter(p => p.totalQty > 0 && p.listPrice > 0)
          .map(p => {
            const avgSellPrice = p.totalRev / p.totalQty;
            const discount = Math.round(((p.listPrice - avgSellPrice) / p.listPrice) * 100);
            return { name: p.name, listPrice: p.listPrice, avgSellPrice: Math.round(avgSellPrice), discount };
          })
          .filter(p => Math.abs(p.discount) > 0)
          .sort((a, b) => b.discount - a.discount)
          .slice(0, 7);
        if (pricingList.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💲 Fiyat Hassasiyet Analizi' : '💲 Price Sensitivity Analysis'}</h3>
              <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Liste fiyatı vs ortalama satış fiyatı' : 'List price vs avg selling price'}</span>
            </div>
            <div className="space-y-2.5">
              {pricingList.map(p => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="text-xs text-gray-700 truncate flex-1">{p.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400">{fmtAna(p.avgSellPrice)}</span>
                    <span className={`text-xs font-bold ${p.discount > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      {p.discount > 0 ? `-${p.discount}%` : `+${Math.abs(p.discount)}%`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Eksi % = liste altı satış (iskonto). Artı % = liste üstü satış.' : 'Negative % = sold below list (discounted). Positive % = sold above list.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 10 && inventory.length > 0 && (() => {
        const now236 = new Date();
        // Compare projected (last month run rate) vs actual this month per category
        const prevMonthStart236 = new Date(now236.getFullYear(), now236.getMonth() - 1, 1);
        const prevMonthEnd236 = new Date(now236.getFullYear(), now236.getMonth(), 0, 23, 59, 59);
        const currMonthStart236 = new Date(now236.getFullYear(), now236.getMonth(), 1);
        const getCatQty = (start: Date, end: Date) => {
          const catQty: Record<string, number> = {};
          for (const o of orders) {
            if (o.status === 'Cancelled') continue;
            try {
              const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
              if (od < start || od > end) continue;
              for (const li of (o.lineItems ?? [])) {
                const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
                const cat = inv?.category || 'Other';
                catQty[cat] = (catQty[cat] ?? 0) + li.quantity;
              }
            } catch { /* skip */ }
          }
          return catQty;
        };
        const prevQty = getCatQty(prevMonthStart236, prevMonthEnd236);
        const currQty = getCatQty(currMonthStart236, new Date());
        const daysElapsed = now236.getDate();
        const daysInMonth236 = new Date(now236.getFullYear(), now236.getMonth() + 1, 0).getDate();
        const cats236 = Object.keys(prevQty);
        if (cats236.length < 2) return null;
        const accuracyList = cats236.map(cat => {
          const projected = Math.round((prevQty[cat] ?? 0) * (daysElapsed / daysInMonth236));
          const actual = currQty[cat] ?? 0;
          const accuracy = projected > 0 ? Math.round((Math.min(actual, projected) / Math.max(actual, projected)) * 100) : null;
          return { cat, projected, actual, accuracy };
        }).filter(c => c.projected > 0 || c.actual > 0).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0)).slice(0, 6);
        const avgAccuracy = accuracyList.filter(c => c.accuracy !== null).reduce((s, c) => s + (c.accuracy ?? 0), 0) / Math.max(accuracyList.filter(c => c.accuracy !== null).length, 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🎯 Talep Tahmin Doğruluğu' : '🎯 Demand Forecast Accuracy'}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${avgAccuracy >= 80 ? 'bg-emerald-100 text-emerald-700' : avgAccuracy >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                Ø %{Math.round(avgAccuracy)} {currentLanguage === 'tr' ? 'doğruluk' : 'accuracy'}
              </span>
            </div>
            <div className="space-y-2.5">
              {accuracyList.map(c => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{c.cat}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">{c.actual} / {c.projected} {currentLanguage === 'tr' ? 'adet' : 'units'}</span>
                      {c.accuracy !== null && <span className={`text-xs font-bold ${c.accuracy >= 80 ? 'text-emerald-600' : c.accuracy >= 60 ? 'text-amber-600' : 'text-red-500'}`}>%{c.accuracy}</span>}
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${(c.accuracy ?? 0) >= 80 ? 'bg-emerald-400' : (c.accuracy ?? 0) >= 60 ? 'bg-amber-400' : 'bg-red-300'}`} style={{ width: `${Math.max(4, c.accuracy ?? 0)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Tahmin: geçen ay çıkış hızı × bu ayın geçen gün sayısı' : 'Forecast: prior month run rate × days elapsed this month'}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && (() => {
        const now238 = new Date();
        const scores238 = inventory.map(i => {
          let score = 100;
          // Low stock penalty
          if ((i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)) score -= 30;
          // No cost price penalty
          if (!i.costPrice && !i.cost) score -= 20;
          // No category penalty
          if (!i.category) score -= 10;
          // Expiry penalty
          if (i.expiryDate) {
            const daysLeft = Math.round((new Date(i.expiryDate).getTime() - now238.getTime()) / 86400000);
            if (daysLeft < 0) score -= 40;
            else if (daysLeft < 30) score -= 25;
            else if (daysLeft < 90) score -= 10;
          }
          return { name: i.name, score: Math.max(0, score), category: i.category ?? '—', stock: i.stockLevel ?? 0 };
        });
        const avgScore = Math.round(scores238.reduce((s, i) => s + i.score, 0) / Math.max(scores238.length, 1));
        const excellent = scores238.filter(i => i.score >= 80).length;
        const warning = scores238.filter(i => i.score >= 50 && i.score < 80).length;
        const critical = scores238.filter(i => i.score < 50).length;
        const worstItems = scores238.filter(i => i.score < 70).sort((a, b) => a.score - b.score).slice(0, 5);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏥 Stok Sağlık Skoru' : '🏥 Inventory Health Score'}</h3>
              <span className={`text-2xl font-black ${avgScore >= 80 ? 'text-emerald-600' : avgScore >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{avgScore}/100</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Sağlıklı' : 'Healthy', value: excellent, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: currentLanguage === 'tr' ? 'Dikkat' : 'Warning', value: warning, color: 'text-amber-600', bg: 'bg-amber-50' },
                { label: currentLanguage === 'tr' ? 'Kritik' : 'Critical', value: critical, color: 'text-red-600', bg: 'bg-red-50' },
              ].map(k => (
                <div key={k.label} className={`${k.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            {worstItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">{currentLanguage === 'tr' ? 'İyileştirme Gereken Ürünler:' : 'Items Needing Attention:'}</p>
                <div className="space-y-1.5">
                  {worstItems.map(item => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate">{item.name}</span>
                      <span className={`font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${item.score < 50 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{item.score}/100</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && orders.length >= 5 && (() => {
        const now241 = new Date();
        const recent90 = new Date(now241); recent90.setDate(recent90.getDate() - 90);
        // Products added to inventory in last 90 days (new launches)
        const newProducts = inventory.filter(i => {
          const m = i as unknown as Record<string,unknown>;
          const createdAt = m.createdAt;
          if (!createdAt) return false;
          try {
            const d = (createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(createdAt as string);
            return d >= recent90;
          } catch { return false; }
        });
        if (newProducts.length === 0) return null;
        // Revenue generated by new products
        const newProdRevMap: Record<string, number> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const isNew = newProducts.some(p => p.id === li.inventoryId || p.name === li.name);
            if (!isNew) continue;
            const key = li.name || li.inventoryId || '';
            newProdRevMap[key] = (newProdRevMap[key] ?? 0) + li.price * li.quantity;
          }
        }
        const launches = newProducts.map(p => ({
          name: p.name,
          rev: newProdRevMap[p.name] ?? newProdRevMap[p.id] ?? 0,
          stock: p.stockLevel ?? 0,
          category: p.category ?? '—',
        })).sort((a, b) => b.rev - a.rev).slice(0, 6);
        const totalLaunchRev = launches.reduce((s, l) => s + l.rev, 0);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🚀 Yeni Ürün Lansmanı Takibi (Son 90 Gün)' : '🚀 New Product Launch Tracker (Last 90 Days)'}</h3>
              <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">{newProducts.length} {currentLanguage === 'tr' ? 'yeni ürün' : 'new products'}</span>
            </div>
            <div className="space-y-2.5 mb-3">
              {launches.map(l => (
                <div key={l.name} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-gray-800">{l.name}</p>
                    <p className="text-[10px] text-gray-400">{l.category} · {l.stock} {currentLanguage === 'tr' ? 'stok' : 'in stock'}</p>
                  </div>
                  <span className={`text-xs font-bold shrink-0 ml-2 ${l.rev > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {l.rev > 0 ? `₺${(l.rev/1000).toFixed(0)}K` : (currentLanguage === 'tr' ? 'Satış yok' : 'No sales')}
                  </span>
                </div>
              ))}
            </div>
            <div className="p-3 bg-purple-50 rounded-xl flex items-center justify-between">
              <span className="text-xs text-purple-700 font-medium">{currentLanguage === 'tr' ? 'Yeni ürün toplam cirosu' : 'Total new product revenue'}</span>
              <span className="text-sm font-black text-purple-700">{fmtAna(totalLaunchRev,'K',0)}</span>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 3 && inventory.length > 0 && (() => {
        const skuRev: Record<string, { name: string; sku: string; rev: number; qty: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
            const sku = inv?.sku || li.sku || li.inventoryId || li.name || '?';
            const name = inv?.name || li.name || sku;
            if (!skuRev[sku]) skuRev[sku] = { name, sku, rev: 0, qty: 0 };
            skuRev[sku].rev += li.price * li.quantity;
            skuRev[sku].qty += li.quantity;
          }
        }
        const skuList = Object.values(skuRev).sort((a, b) => b.rev - a.rev).slice(0, 8);
        if (skuList.length < 2) return null;
        const totalSkuRev = skuList.reduce((s, s2) => s + s2.rev, 0);
        const maxSkuRev = skuList[0].rev;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📦 SKU Bazlı Ciro Analizi (Top 8)' : '📦 Revenue per SKU (Top 8)'}</h3>
            <div className="space-y-2.5">
              {skuList.map((s, i) => {
                const pct = totalSkuRev > 0 ? Math.round((s.rev / totalSkuRev) * 100) : 0;
                return (
                  <div key={s.sku}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-gray-800 truncate block">{s.name}</span>
                        <span className="text-[10px] text-gray-400">{s.sku} · {s.qty} {currentLanguage === 'tr' ? 'adet' : 'units'}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">%{pct}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(s.rev,'K',0)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${i === 0 ? 'bg-brand' : i <= 2 ? 'bg-blue-400' : 'bg-gray-300'}`} style={{ width: `${Math.max(4, Math.round((s.rev / maxSkuRev) * 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now254 = new Date();
        const days254 = 90;
        const cutoff254 = new Date(now254); cutoff254.setDate(cutoff254.getDate() - days254);
        // Profitability Index = (margin % × velocity) / 100
        const prodPI: Record<string, { name: string; margin: number; velocity: number; pi: number; rev: number }> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            if (od < cutoff254) continue;
            for (const li of (o.lineItems ?? [])) {
              const inv = inventory.find(ii => ii.id === li.inventoryId || ii.name === li.name);
              if (!inv) continue;
              const key = inv.id;
              const margin = li.price > 0 ? Math.round(((li.price - itemCostTRY(inv, exchangeRates)) / li.price) * 100) : 0;
              if (!prodPI[key]) prodPI[key] = { name: inv.name, margin, velocity: 0, pi: 0, rev: 0 };
              prodPI[key].velocity += li.quantity;
              prodPI[key].rev += li.price * li.quantity;
            }
          } catch { /* skip */ }
        }
        const maxVel254 = Math.max(...Object.values(prodPI).map(p => p.velocity), 1);
        const piList = Object.values(prodPI)
          .map(p => ({ ...p, pi: Math.round((p.margin * (p.velocity / maxVel254)) * 10) / 10 }))
          .sort((a, b) => b.pi - a.pi)
          .slice(0, 8);
        if (piList.length < 2) return null;
        const maxPI = Math.max(...piList.map(p => p.pi), 1);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏆 Ürün Karlılık Endeksi (PI)' : '🏆 Product Profitability Index (PI)'}</h3>
              <span className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Marj × Hız' : 'Margin × Velocity'}</span>
            </div>
            <p className="text-[10px] text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Son 90 gün · Yüksek PI = yüksek marj + hızlı satış' : 'Last 90 days · High PI = high margin + fast moving'}</p>
            <div className="space-y-2.5">
              {piList.map((p, i) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{p.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">%{p.margin} · {p.velocity}{currentLanguage === 'tr' ? 'ad' : 'u'}</span>
                      <span className={`text-xs font-bold ${i === 0 ? 'text-brand' : i <= 2 ? 'text-emerald-600' : 'text-gray-600'}`}>PI {p.pi}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${i === 0 ? 'bg-brand' : i <= 2 ? 'bg-emerald-400' : 'bg-blue-300'}`} style={{ width: `${Math.max(4, Math.round((p.pi / maxPI) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && orders.length >= 3 && (() => {
        const now257 = new Date();
        const lastSaleDate: Record<string, Date> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          try {
            const od = (o.createdAt as { toDate?: () => Date }).toDate?.() ?? new Date(o.createdAt as string);
            for (const li of (o.lineItems ?? [])) {
              const key = li.inventoryId || li.name || '';
              if (!key) continue;
              if (!lastSaleDate[key] || od > lastSaleDate[key]) lastSaleDate[key] = od;
            }
          } catch { /* skip */ }
        }
        const staleProducts = inventory
          .map(i => {
            const lastDate = lastSaleDate[i.id] ?? lastSaleDate[i.name] ?? lastSaleDate[i.sku || ''];
            const days = lastDate ? Math.round((now257.getTime() - lastDate.getTime()) / 86400000) : null;
            return { name: i.name, days, stock: i.stockLevel ?? 0, value: (i.stockLevel ?? 0) * itemCostTRY(i, exchangeRates) };
          })
          .filter(p => p.days !== null && p.days > 30 && p.stock > 0)
          .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
          .slice(0, 8) as Array<{ name: string; days: number; stock: number; value: number }>;
        if (staleProducts.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📆 Son Satıştan Bu Yana Geçen Gün' : '📆 Days Since Last Sale (with Stock)'}</h3>
              <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-bold">{staleProducts.length} {currentLanguage === 'tr' ? 'ürün' : 'products'}</span>
            </div>
            <div className="space-y-2.5">
              {staleProducts.map(p => (
                <div key={p.name} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-gray-400">{p.stock} {currentLanguage === 'tr' ? 'stok' : 'in stock'} · {fmtAna(p.value,'full',0)}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${p.days > 90 ? 'bg-red-100 text-red-700' : p.days > 60 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                    {p.days}d
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length > 0 && (() => {
        const inventoryVal259 = inventory.reduce((s, i) => s + itemCostTRY(i, exchangeRates) * (i.stockLevel ?? 0), 0);
        if (inventoryVal259 === 0) return null;
        // Carrying cost = typically 20-30% of inventory value per year
        const carryingRates = [
          { label: currentLanguage === 'tr' ? 'Muhafaza & Depo' : 'Storage & Handling', pct: 5, color: 'bg-blue-300' },
          { label: currentLanguage === 'tr' ? 'Sermaye Maliyeti' : 'Capital Cost', pct: 8, color: 'bg-amber-300' },
          { label: currentLanguage === 'tr' ? 'Sigorta & Vergi' : 'Insurance & Tax', pct: 3, color: 'bg-purple-300' },
          { label: currentLanguage === 'tr' ? 'Eskime & Fire' : 'Obsolescence & Loss', pct: 4, color: 'bg-red-300' },
        ];
        const totalCarryPct = carryingRates.reduce((s, r) => s + r.pct, 0);
        const annualCarryCost = Math.round(inventoryVal259 * (totalCarryPct / 100));
        const monthlyCarryCost = Math.round(annualCarryCost / 12);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '💼 Stok Taşıma Maliyeti Tahmini' : '💼 Inventory Carrying Cost Estimate'}</h3>
              <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full font-bold">%{totalCarryPct} / {currentLanguage === 'tr' ? 'yıl' : 'yr'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-red-600">{fmtAna(annualCarryCost,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Yıllık taşıma maliyeti' : 'Annual carrying cost'}</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-amber-600">{fmtAna(monthlyCarryCost,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Aylık taşıma maliyeti' : 'Monthly carrying cost'}</p>
              </div>
            </div>
            <div className="space-y-2">
              {carryingRates.map(r => (
                <div key={r.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-sm ${r.color}`} />
                    <span className="text-gray-600">{r.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">%{r.pct}</span>
                    <span className="font-bold text-gray-700">{fmtAna(Math.round(inventoryVal259 * r.pct / 100),'full',0)}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? `Stok değeri: ₺${(inventoryVal259/1000).toFixed(0)}K · Taşıma maliyeti genellikle stok değerinin %20-30\'udur.` : `Inventory value: ₺${(inventoryVal259/1000).toFixed(0)}K · Carrying cost is typically 20-30% of inventory value.`}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const now = new Date();
        const risky = inventory.filter(item => {
          if (!item.expiryDate) return false;
          const exp = new Date(item.expiryDate);
          const daysLeft = Math.floor((exp.getTime() - now.getTime()) / 86400000);
          return daysLeft <= 180 && daysLeft > 0 && item.stockLevel > 0;
        }).map(item => {
          const exp = new Date(item.expiryDate!);
          const daysLeft = Math.floor((exp.getTime() - now.getTime()) / 86400000);
          const writeDownValue = item.stockLevel * itemCostTRY(item, exchangeRates);
          return { name: item.name, sku: item.sku, daysLeft, stock: item.stockLevel, value: writeDownValue };
        }).sort((a,b) => a.daysLeft - b.daysLeft).slice(0, 8);
        if (risky.length === 0) {
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stok Değer Düşüklüğü Riski' : 'Inventory Write-Down Risk'}</h3>
              <p className="text-xs text-gray-500 mt-2 text-center py-4">✅ No inventory expiring within 180 days</p>
            </div>
          );
        }
        const totalRisk = risky.reduce((s,r)=>s+r.value,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stok Değer Düşüklüğü Riski' : 'Inventory Write-Down Risk'}</h3>
            <p className="text-xs text-gray-500 mb-3">Items expiring within 180 days — potential write-down: {fmtAna(totalRisk,'full',0)}</p>
            <div className="space-y-2">
              {risky.map((r,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: r.daysLeft <= 30 ? '#fef2f2' : r.daysLeft <= 90 ? '#fffbeb' : '#f0fdf4' }}>
                  <span className="font-medium text-gray-800">{r.name} <span className="text-gray-400">({r.sku})</span></span>
                  <span className="font-bold" style={{ color: r.daysLeft <= 30 ? '#ef4444' : r.daysLeft <= 90 ? '#f59e0b' : '#10b981' }}>{r.daysLeft}d left</span>
                  <span className="text-gray-600">Qty: {r.stock}</span>
                  <span className="text-gray-700 font-semibold">{fmtAna(r.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const supplierMap: Record<string, {items: number; avgCost: number; totalValue: number}> = {};
        inventory.forEach(item => {
          const sup = item.supplier || 'Unknown';
          if (!supplierMap[sup]) supplierMap[sup] = { items: 0, avgCost: 0, totalValue: 0 };
          supplierMap[sup].items++;
          supplierMap[sup].totalValue += itemCostTRY(item, exchangeRates) * item.stockLevel;
          supplierMap[sup].avgCost += itemCostTRY(item, exchangeRates);
        });
        const suppliers = Object.entries(supplierMap)
          .map(([name, d]) => ({ name, items: d.items, avgCost: d.items > 0 ? d.avgCost / d.items : 0, totalValue: d.totalValue }))
          .sort((a,b) => b.totalValue - a.totalValue)
          .slice(0, 8);
        if (suppliers.length === 0) return null;
        const totalVal = suppliers.reduce((s,s2) => s + s2.totalValue, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Tedarikçi Stok Bağımlılığı' : 'Supplier Inventory Exposure'}</h3>
            <p className="text-xs text-gray-500 mb-3">Stock value at cost by supplier — top {suppliers.length}</p>
            <div className="space-y-2">
              {suppliers.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-32 truncate font-medium">{s.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-purple-500" style={{ width: `${totalVal > 0 ? (s.totalValue/totalVal*100) : 0}%` }} />
                  </div>
                  <span className="text-xs text-gray-600 w-28 text-right">{fmtAna(s.totalValue,'full',0)} · {s.items} SKUs</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Total supplier exposure: {fmtAna(totalVal,'full',0)}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 10 && (() => {
        const now = new Date();
        const months = Array.from({length:6}, (_,i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
          return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`, year: d.getFullYear(), month: d.getMonth() };
        });
        const catRevenue: Record<string, Record<string, number>> = {};
        orders.forEach(o => {
          const d = (o.createdAt as {toDate?:()=>Date}).toDate?.() ?? new Date(o.createdAt as string);
          const mkey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          (o.lineItems || []).forEach(li => {
            const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
            const cat = inv?.category || 'Uncategorized';
            if (!catRevenue[cat]) catRevenue[cat] = {};
            catRevenue[cat][mkey] = (catRevenue[cat][mkey] || 0) + li.price * li.quantity;
          });
        });
        const topCats = Object.entries(catRevenue)
          .map(([cat, mdata]) => ({ cat, total: Object.values(mdata).reduce((s,v)=>s+v,0) }))
          .sort((a,b) => b.total - a.total).slice(0,4).map(c => c.cat);
        if (topCats.length === 0) return null;
        const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Revenue by Category — 6-Month Trend</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2">Category</th>
                    {months.map(m => <th key={m.key} className="text-right pb-2">{m.label}</th>)}
                    <th className="text-right pb-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {topCats.map((cat, ci) => (
                    <tr key={cat} className="border-b border-gray-50">
                      <td className="py-1.5 font-medium" style={{ color: colors[ci] }}>{cat}</td>
                      {months.map(m => (
                        <td key={m.key} className="py-1.5 text-right text-gray-600">
                          {catRevenue[cat][m.key] ? `₺${(catRevenue[cat][m.key]/1000).toFixed(0)}k` : '-'}
                        </td>
                      ))}
                      <td className="py-1.5 text-right font-bold text-gray-800">
                        {fmtAna(Object.values(catRevenue[cat]).reduce((s,v)=>s+v,0),'K',0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && inventory.length >= 3 && (() => {
        const stockoutMap: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const key = m.productName || 'Unknown';
          stockoutMap[key] = (stockoutMap[key] || 0) + 1;
        });
        const lowStockItems = inventory.filter(item => item.stockLevel <= item.lowStockThreshold && item.stockLevel >= 0)
          .map(item => ({ name: item.name, stock: item.stockLevel, threshold: item.lowStockThreshold, outFreq: stockoutMap[item.name] || 0 }))
          .sort((a,b) => b.outFreq - a.outFreq).slice(0,8);
        if (lowStockItems.length === 0) {
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stoksuz Kalma Sıklığı İzleyici' : 'Stockout Frequency Monitor'}</h3>
              <p className="text-xs text-green-600 text-center py-4">✅ No items currently at or below reorder threshold</p>
            </div>
          );
        }
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stoksuz Kalma Sıklığı İzleyici' : 'Stockout Frequency Monitor'}</h3>
            <p className="text-xs text-gray-500 mb-3">Items at/below threshold sorted by movement frequency</p>
            <div className="space-y-2">
              {lowStockItems.map((item,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-amber-50">
                  <span className="font-medium text-gray-800 truncate w-36">{item.name}</span>
                  <span className="text-amber-700">Stock: {item.stock} / Min: {item.threshold}</span>
                  <span className="text-gray-500">{item.outFreq} outflows</span>
                  <span className={`font-bold ${item.stock === 0 ? 'text-red-600' : 'text-amber-600'}`}>{item.stock === 0 ? '🔴 OUT' : '🟡 LOW'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const now = new Date();
        const velocityMap: Record<string, {units: number; value: number}> = {};
        inventoryMovements.filter(m => {
          if (m.type !== 'out') return false;
          const d = (m.timestamp as {toDate?:()=>Date}).toDate?.() ?? new Date(m.timestamp as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        }).forEach(m => {
          const key = m.productName || 'Unknown';
          if (!velocityMap[key]) velocityMap[key] = { units: 0, value: 0 };
          velocityMap[key].units += m.quantity || 1;
          const inv = inventory.find(it => it.name === key);
          velocityMap[key].value += (m.quantity || 1) * (inv ? itemCostTRY(inv, exchangeRates) : 0);
        });
        const top = Object.entries(velocityMap)
          .map(([name, d]) => ({ name, units: d.units, value: d.value, dailyVelocity: d.units / 30 }))
          .sort((a,b) => b.units - a.units).slice(0,8);
        if (top.length === 0) return null;
        const maxUnits = Math.max(...top.map(t=>t.units));
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Top Products by Sales Velocity (Last 30 Days)</h3>
            <p className="text-xs text-gray-500 mb-4">Units shipped from inventory movements</p>
            <div className="space-y-2">
              {top.map((t,i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-400 w-4">{i+1}</span>
                  <span className="text-xs text-gray-700 truncate w-36 font-medium">{t.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${maxUnits>0?(t.units/maxUnits*100):0}%` }} />
                  </div>
                  <span className="text-xs text-gray-600 w-16 text-right">{t.units} units</span>
                  <span className="text-xs text-gray-400 w-14 text-right">{t.dailyVelocity.toFixed(1)}/day</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 10 && orders.length >= 5 && (() => {
        const skuSales: Record<string, number> = {};
        orders.forEach(o => (o.lineItems||[]).forEach(li => { skuSales[li.sku] = (skuSales[li.sku]||0) + li.quantity; }));
        const skuData = inventory.map(item => ({
          sku: item.sku, name: item.name,
          sold: skuSales[item.sku] || 0,
          stock: item.stockLevel,
          value: item.stockLevel * itemCostTRY(item, exchangeRates),
          category: item.category || 'Other',
        }));
        const noSales = skuData.filter(s => s.sold === 0 && s.stock > 0).sort((a,b)=>b.value-a.value).slice(0,6);
        const lowSales = skuData.filter(s => s.sold > 0 && s.sold < 5 && s.stock > 0).slice(0,4);
        if (noSales.length === 0 && lowSales.length === 0) return null;
        const deadValue = noSales.reduce((s,d)=>s+d.value,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'SKU Sadeleştirme Adayları' : 'SKU Rationalization Candidates'}</h3>
            <p className="text-xs text-gray-500 mb-3">Zero-sales SKUs holding {fmtAna(deadValue,'full',0)} in capital</p>
            {noSales.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-bold text-red-600 mb-1">🔴 Discontinue (0 sales, stock in hand)</p>
                <div className="space-y-1">
                  {noSales.map((s,i) => (
                    <div key={i} className="flex justify-between text-xs p-1.5 bg-red-50 rounded-lg">
                      <span className="text-gray-700 truncate w-40">{s.name}</span>
                      <span className="text-gray-400">{s.sku}</span>
                      <span className="font-medium text-red-700">Qty: {s.stock} · {fmtAna(s.value,'full',0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lowSales.length > 0 && (
              <div>
                <p className="text-xs font-bold text-amber-600 mb-1">🟡 Review (fewer than 5 units sold)</p>
                <div className="space-y-1">
                  {lowSales.map((s,i) => (
                    <div key={i} className="flex justify-between text-xs p-1.5 bg-amber-50 rounded-lg">
                      <span className="text-gray-700 truncate w-40">{s.name}</span>
                      <span className="text-gray-400">{s.sku}</span>
                      <span className="font-medium text-amber-700">{s.sold} sold</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const now = new Date();
        const velocityMap: Record<string, number> = {};
        inventoryMovements.filter(m => {
          if (m.type !== 'out') return false;
          const d = (m.timestamp as {toDate?:()=>Date}).toDate?.() ?? new Date(m.timestamp as string);
          return (now.getTime() - d.getTime()) / 86400000 <= 30;
        }).forEach(m => {
          velocityMap[m.productName || 'Unknown'] = (velocityMap[m.productName || 'Unknown'] || 0) + (m.quantity || 1);
        });
        const restockItems = inventory.filter(item => {
          const dailyVel = (velocityMap[item.name] || 0) / 30;
          const daysLeft = dailyVel > 0 ? item.stockLevel / dailyVel : Infinity;
          return daysLeft <= 60 && item.stockLevel > 0;
        }).map(item => {
          const dailyVel = (velocityMap[item.name] || 0) / 30;
          const daysLeft = dailyVel > 0 ? Math.floor(item.stockLevel / dailyVel) : 60;
          const unitsNeeded = Math.ceil(dailyVel * 30); // 30-day restock
          const cost = unitsNeeded * itemCostTRY(item, exchangeRates);
          return { name: item.name, sku: item.sku, daysLeft, unitsNeeded, cost, dailyVel };
        }).sort((a,b)=>a.daysLeft-b.daysLeft).slice(0,6);
        if (restockItems.length === 0) return null;
        const totalRestockCost = restockItems.reduce((s,r)=>s+r.cost,0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Restock Cost Forecast (Next 60 Days)</h3>
            <p className="text-xs text-gray-500 mb-3">Estimated 30-day restock cost: <span className="font-bold text-purple-700">{fmtAna(totalRestockCost,'full',0)}</span></p>
            <div className="space-y-2">
              {restockItems.map((r,i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: r.daysLeft <= 14 ? '#fef2f2' : r.daysLeft <= 30 ? '#fffbeb' : '#f0fdf4' }}>
                  <span className="font-medium text-gray-800 truncate w-36">{r.name}</span>
                  <span style={{ color: r.daysLeft <= 14 ? '#ef4444' : r.daysLeft <= 30 ? '#f59e0b' : '#10b981' }} className="font-bold">{r.daysLeft}d left</span>
                  <span className="text-gray-500">{r.unitsNeeded} units</span>
                  <span className="font-bold text-purple-700">{fmtAna(r.cost,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 3 && (() => {
        const inbound = inventoryMovements.filter(m => m.type === 'in').reduce((s,m)=>s+(m.quantity||0),0);
        const outbound = inventoryMovements.filter(m => m.type === 'out' && (m.quantity||0) > 0).reduce((s,m)=>s+(m.quantity||0),0);
        const totalItems = inventory.length;
        const zeroStock = inventory.filter(i=>i.stockLevel === 0).length;
        const negStock = inventory.filter(i=>i.stockLevel < 0).length;
        const totalStockValue = inventory.reduce((s,i)=>s+Math.max(0,i.stockLevel)*itemCostTRY(i,exchangeRates),0);
        const shrinkageValue = inventory.filter(i=>i.stockLevel < 0).reduce((s,i)=>s+Math.abs(i.stockLevel)*(i.costPrice||0),0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Stok Sağlığı ve Fire' : 'Inventory Health & Shrinkage'}</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-blue-700">{inbound.toLocaleString()}</div>
                <div className="text-[10px] text-gray-500">Units Received (Total)</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-green-700">{outbound.toLocaleString()}</div>
                <div className="text-[10px] text-gray-500">Units Shipped (Total)</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${negStock > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <div className="text-xl font-black" style={{ color: negStock > 0 ? '#ef4444' : '#10b981' }}>{negStock}</div>
                <div className="text-[10px] text-gray-500">Negative Stock SKUs</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-700">{zeroStock}</div>
                <div className="text-[10px] text-gray-500">Zero Stock SKUs ({totalItems} total)</div>
              </div>
            </div>
            {shrinkageValue > 0 && (
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-sm font-bold text-red-700">Estimated Shrinkage Exposure: {fmtAna(shrinkageValue,'full',0)}</div>
                <div className="text-xs text-gray-500 mt-0.5">From items with negative stock levels</div>
              </div>
            )}
            <div className="mt-3 text-xs text-gray-500 text-center">Total inventory at cost: {fmtAna(totalStockValue,'full',0)}</div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 10 && (() => {
        const pairCounts: Record<string, number> = {};
        orders.forEach(o => {
          const items = (o.lineItems||[]).map(li=>li.name||li.sku).filter(Boolean);
          for (let a = 0; a < items.length; a++) {
            for (let b = a+1; b < items.length; b++) {
              const key = [items[a], items[b]].sort().join(' + ');
              pairCounts[key] = (pairCounts[key]||0)+1;
            }
          }
        });
        const topPairs = Object.entries(pairCounts)
          .filter(([,count])=>count>=2)
          .sort((a,b)=>b[1]-a[1]).slice(0,6);
        if (topPairs.length === 0) return null;
        const maxCount = topPairs[0][1];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ürün Paketi Yakınlığı' : 'Product Bundle Affinity'}</h3>
            <p className="text-xs text-gray-500 mb-4">Products frequently ordered together — top co-purchase pairs</p>
            <div className="space-y-3">
              {topPairs.map(([pair, count],i) => {
                const [prod1, prod2] = pair.split(' + ');
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-xs font-medium text-gray-800">{prod1}</div>
                      <div className="text-[10px] text-gray-400">+ {prod2}</div>
                    </div>
                    <div className="w-24 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${maxCount>0?(count/maxCount*100):0}%` }} />
                    </div>
                    <span className="text-xs font-bold text-orange-600 w-12 text-right">{count}x</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const catCost: Record<string, {items: number; value: number; units: number}> = {};
        inventory.forEach(item => {
          const cat = item.category || 'Uncategorized';
          if (!catCost[cat]) catCost[cat] = { items: 0, value: 0, units: 0 };
          catCost[cat].items++;
          catCost[cat].value += item.stockLevel * itemCostTRY(item, exchangeRates);
          catCost[cat].units += item.stockLevel;
        });
        const cats = Object.entries(catCost).sort((a,b)=>b[1].value-a[1].value);
        if (cats.length === 0) return null;
        const totalValue = cats.reduce((s,[,d])=>s+d.value,0);
        const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Kategoriye Göre Stok Maliyeti' : 'Inventory Cost by Category'}</h3>
            <p className="text-xs text-gray-500 mb-3">Total at cost: {fmtAna(totalValue,'full',0)}</p>
            <div className="flex h-4 rounded-full overflow-hidden mb-4 gap-0.5">
              {cats.slice(0,8).map(([,d],i) => (
                <div key={i} style={{ width: `${totalValue>0?(d.value/totalValue*100):0}%`, background: colors[i%colors.length], minWidth: d.value>0?'2px':'0' }} title={`${cats[i][0]}: ₺${d.value.toLocaleString()}`} />
              ))}
            </div>
            <div className="space-y-2">
              {cats.slice(0,6).map(([cat,d],i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors[i%colors.length] }} />
                  <span className="text-xs text-gray-700 truncate flex-1">{cat}</span>
                  <span className="text-xs text-gray-400">{d.items} SKUs</span>
                  <span className="text-xs text-gray-400">{d.units} units</span>
                  <span className="text-xs font-bold text-gray-800">{fmtAna(d.value,'full',0)}</span>
                  <span className="text-xs text-gray-400 w-8 text-right">{totalValue>0?((d.value/totalValue)*100).toFixed(0):0}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && orders.length >= 5 && (() => {
        const catSales: Record<string, number> = {};
        const catStock: Record<string, number> = {};
        orders.forEach(o => (o.lineItems||[]).forEach(li => {
          const inv = inventory.find(it=>it.id===li.inventoryId||it.sku===li.sku);
          const cat = inv?.category || 'Uncategorized';
          catSales[cat] = (catSales[cat]||0) + li.quantity;
        }));
        inventory.forEach(item => {
          const cat = item.category || 'Uncategorized';
          catStock[cat] = (catStock[cat]||0) + item.stockLevel;
        });
        const cats = Object.keys({...catSales, ...catStock});
        const data = cats.map(cat => ({
          cat,
          stock: catStock[cat]||0,
          sales: catSales[cat]||0,
          ratio: catSales[cat]>0 ? (catStock[cat]||0)/catSales[cat] : null,
        })).filter(d=>d.stock>0||d.sales>0).sort((a,b)=>(b.sales)-(a.sales)).slice(0,7);
        if (data.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Kategoriye Göre Stok/Satış Oranı' : 'Stock-to-Sales Ratio by Category'}</h3>
            <p className="text-xs text-gray-500 mb-3">Ratio = current stock ÷ total units sold · lower = faster moving</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2">Category</th>
                    <th className="text-right pb-2">Stock</th>
                    <th className="text-right pb-2">Sold</th>
                    <th className="text-right pb-2">S:S Ratio</th>
                    <th className="text-right pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d,i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 font-medium text-gray-800">{d.cat}</td>
                      <td className="py-1.5 text-right text-gray-600">{d.stock}</td>
                      <td className="py-1.5 text-right text-gray-600">{d.sales}</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: d.ratio===null?'#94a3b8':d.ratio<=1?'#10b981':d.ratio<=3?'#f59e0b':'#ef4444' }}>
                        {d.ratio===null ? 'N/A' : d.ratio.toFixed(1)+'x'}
                      </td>
                      <td className="py-1.5 text-right text-[10px]" style={{ color: d.ratio===null?'#94a3b8':d.ratio<=1?'#10b981':d.ratio<=3?'#f59e0b':'#ef4444' }}>
                        {d.ratio===null?'No sales':d.ratio<=1?'Fast':d.ratio<=3?'Normal':'Slow'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const critical = inventory.filter(i => i.stockLevel === 0);
        const low = inventory.filter(i => i.stockLevel > 0 && i.stockLevel <= i.lowStockThreshold);
        const healthy = inventory.filter(i => i.stockLevel > i.lowStockThreshold);
        const totalValue = inventory.reduce((s, i) => s + i.stockLevel * itemCostTRY(i, exchangeRates), 0);
        const criticalValue = critical.reduce((s, i) => s + i.lowStockThreshold * itemCostTRY(i, exchangeRates), 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? 'Stok Yenileme Uyarı Paneli' : 'Inventory Reorder Alert Dashboard'}</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-red-600">{critical.length}</div>
                <div className="text-[10px] text-gray-500">Out of Stock</div>
                <div className="text-[9px] text-red-400 mt-0.5">{fmtAna(criticalValue,'full',0)} to restock</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-amber-600">{low.length}</div>
                <div className="text-[10px] text-gray-500">Low Stock</div>
                <div className="text-[9px] text-amber-400 mt-0.5">at or below threshold</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-green-600">{healthy.length}</div>
                <div className="text-[10px] text-gray-500">Healthy Stock</div>
                <div className="text-[9px] text-green-400 mt-0.5">above threshold</div>
              </div>
            </div>
            {critical.slice(0, 4).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-bold text-red-600 mb-1">🔴 Immediate Reorder Required</p>
                {critical.slice(0, 4).map((item, i) => (
                  <div key={i} className="flex justify-between text-xs p-1.5 bg-red-50 rounded-lg">
                    <span className="text-gray-800 font-medium truncate w-44">{item.name}</span>
                    <span className="text-gray-400">{item.sku}</span>
                    <span className="text-red-600 font-bold">0 in stock</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3 text-center">Total inventory value: {fmtAna(totalValue,'full',0)}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && orders.length >= 5 && (() => {
        const productRev: Record<string, {revenue: number; cost: number; qty: number}> = {};
        orders.forEach(o => (o.lineItems || []).forEach(li => {
          const inv = inventory.find(it => it.id === li.inventoryId || it.sku === li.sku);
          const cost = inv ? itemCostTRY(inv, exchangeRates) : (li.costPrice || 0);
          const key = li.name || li.sku;
          if (!productRev[key]) productRev[key] = {revenue: 0, cost: 0, qty: 0};
          productRev[key].revenue += li.price * li.quantity;
          productRev[key].cost += cost * li.quantity;
          productRev[key].qty += li.quantity;
        }));
        const ranked = Object.entries(productRev)
          .map(([name, d]) => ({name, ...d, margin: d.revenue - d.cost, marginPct: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue * 100) : 0}))
          .filter(p => p.revenue > 0)
          .sort((a, b) => b.marginPct - a.marginPct)
          .slice(0, 8);
        if (ranked.length === 0) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Product Margin Ranking (Top 8 by %)</h3>
            <div className="space-y-2">
              {ranked.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-400 w-4">#{i + 1}</span>
                  <span className="text-xs text-gray-700 truncate w-32 font-medium">{p.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${Math.max(2, p.marginPct)}%`,
                      background: p.marginPct >= 40 ? '#10b981' : p.marginPct >= 20 ? '#3b82f6' : p.marginPct >= 0 ? '#f59e0b' : '#ef4444'
                    }} />
                  </div>
                  <span className="text-xs font-bold w-10 text-right" style={{color: p.marginPct >= 40 ? '#10b981' : p.marginPct >= 20 ? '#3b82f6' : '#f59e0b'}}>{p.marginPct.toFixed(0)}%</span>
                  <span className="text-xs text-gray-400 w-16 text-right">{fmtAna(p.margin,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 5 && (() => {
        const outMoves = inventoryMovements.filter(m => m.type === 'out');
        const soldByProduct: Record<string, number> = {};
        outMoves.forEach(m => { soldByProduct[m.productName || 'Unknown'] = (soldByProduct[m.productName || 'Unknown'] || 0) + (m.quantity || 0); });
        const turnoverData = inventory
          .filter(item => item.stockLevel > 0 || soldByProduct[item.name])
          .map(item => {
            const sold = soldByProduct[item.name] || 0;
            const avgStock = (item.stockLevel + (item.stockLevel + sold)) / 2;
            const turnover = avgStock > 0 ? sold / avgStock : 0;
            return { name: item.name, turnover, sold, stock: item.stockLevel };
          })
          .filter(d => d.turnover > 0)
          .sort((a, b) => b.turnover - a.turnover)
          .slice(0, 8);
        if (turnoverData.length < 2) return null;
        const maxT = Math.max(...turnoverData.map(d => d.turnover), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stok Devir Hızı' : 'Stock Turnover Rate'}</h3>
            <p className="text-xs text-gray-500 mb-4">Units sold ÷ average stock level · higher = faster-moving inventory</p>
            <div className="space-y-2">
              {turnoverData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${(d.turnover / maxT) * 100}%`, background: d.turnover >= 2 ? '#10b981' : d.turnover >= 1 ? '#f59e0b' : '#ef4444'}} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{color: d.turnover >= 2 ? '#10b981' : d.turnover >= 1 ? '#f59e0b' : '#ef4444'}}>{d.turnover.toFixed(2)}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const atRisk = inventory
          .filter(item => { const rp = (item.reorderPoint as number | undefined) ?? item.lowStockThreshold ?? 5; return item.stockLevel > 0 && item.stockLevel <= rp; })
          .sort((a, b) => a.stockLevel - b.stockLevel)
          .slice(0, 8);
        if (atRisk.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stoksuz Kalma Riski Uyarısı' : 'Stockout Risk Alert'}</h3>
            <p className="text-xs text-gray-500 mb-4">{atRisk.length} SKU{atRisk.length !== 1 ? 's' : ''} at or below reorder point — action needed</p>
            <div className="space-y-2">
              {atRisk.map((item, i) => {
                const reorder: number = (item.reorderPoint as number | undefined) ?? item.lowStockThreshold ?? 5;
                const riskPct = reorder > 0 ? Math.min((item.stockLevel / reorder) * 100, 100) : 100;
                const color = riskPct <= 30 ? '#ef4444' : riskPct <= 60 ? '#f59e0b' : '#10b981';
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-32 truncate">{item.name}</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{width: `${riskPct}%`, background: color}} />
                    </div>
                    <span className="text-xs font-bold w-20 text-right" style={{color}}>{item.stockLevel} / {reorder} units</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const catVal: Record<string, {count: number; value: number; stock: number}> = {};
        inventory.forEach(item => {
          const cat = item.category || 'Uncategorised';
          if (!catVal[cat]) catVal[cat] = {count: 0, value: 0, stock: 0};
          catVal[cat].count++;
          catVal[cat].stock += item.stockLevel;
          catVal[cat].value += item.stockLevel * itemCostTRY(item, exchangeRates);
        });
        const cats334 = Object.entries(catVal).map(([cat, d]) => ({cat, ...d})).sort((a, b) => b.value - a.value).slice(0, 8);
        if (cats334.length < 2) return null;
        const totalVal334 = cats334.reduce((s, c) => s + c.value, 0);
        const maxVal334 = Math.max(...cats334.map(c => c.value), 1);
        const colors334 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6','#06b6d4'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Kategoriye Göre Stok Değeri' : 'Inventory Value by Category'}</h3>
            <p className="text-xs text-gray-500 mb-4">Total stock value · {fmtAna(totalVal334,'full',0)}</p>
            <div className="space-y-2">
              {cats334.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{c.cat}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(c.value / maxVal334) * 100}%`, background: colors334[i % colors334.length]}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-12 text-right">{c.count} SKU</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors334[i % colors334.length]}}>{fmtAna(c.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 5 && (() => {
        const lineFreq: Record<string, {orderCount: number; totalQty: number; revenue: number}> = {};
        orders.forEach(o => {
          (o.lineItems || []).forEach((li: {name?: string; quantity?: number; price?: number; unitPrice?: number}) => {
            const name = li.name || 'Unknown';
            if (!lineFreq[name]) lineFreq[name] = {orderCount: 0, totalQty: 0, revenue: 0};
            lineFreq[name].orderCount++;
            lineFreq[name].totalQty += li.quantity || 1;
            lineFreq[name].revenue += (li.price || li.unitPrice || 0) * (li.quantity || 1);
          });
        });
        const topProducts = Object.entries(lineFreq).map(([name, d]) => ({name, ...d})).filter(d => d.orderCount >= 2).sort((a, b) => b.orderCount - a.orderCount).slice(0, 8);
        if (topProducts.length < 2) return null;
        const maxOC = Math.max(...topProducts.map(p => p.orderCount), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'En Çok Sipariş Edilen Ürünler' : 'Most-Ordered Products'}</h3>
            <p className="text-xs text-gray-500 mb-4">Products by number of orders they appear in</p>
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{p.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-teal-400 transition-all" style={{width: `${(p.orderCount / maxOC) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{p.totalQty} qty</span>
                  <span className="text-xs font-bold text-teal-600 w-10 text-right">{p.orderCount}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const toTs344 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthIO: Record<string, {in: number; out: number}> = {};
        inventoryMovements.forEach(m => {
          const ts = toTs344(m.timestamp);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthIO[key]) monthIO[key] = {in: 0, out: 0};
          if (m.type === 'in') monthIO[key].in += m.quantity || 0;
          else monthIO[key].out += m.quantity || 0;
        });
        const keys344 = Object.keys(monthIO).sort().slice(-7);
        if (keys344.length < 2) return null;
        const maxQty = Math.max(...keys344.map(k => Math.max(monthIO[k].in, monthIO[k].out)), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stok Girişi ve Çıkışı' : 'Inventory Inflow vs Outflow'}</h3>
            <p className="text-xs text-gray-500 mb-4">Monthly stock movement volume · green = in, red = out</p>
            <div className="flex items-end gap-2 h-24 mb-2">
              {keys344.map(k => {
                const {in: inV, out: outV} = monthIO[k];
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-0">
                    <div className="w-full flex gap-0.5 items-end" style={{height: '80px'}}>
                      <div className="flex-1 rounded-t-sm bg-emerald-400" style={{height: `${Math.max((inV / maxQty) * 72, 2)}px`}} />
                      <div className="flex-1 rounded-t-sm bg-red-400" style={{height: `${Math.max((outV / maxQty) * 72, 2)}px`}} />
                    </div>
                    <span className="text-[9px] text-gray-400 mt-0.5">{k.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 5 && (() => {
        const toTs348 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthCOGS: Record<string, number> = {};
        orders.forEach(o => {
          const d = new Date(toTs348(o.createdAt));
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const cogs = (o.lineItems || []).reduce((s: number, li: {costPrice?: number; quantity?: number; sku?: string}) => {
            const item = inventory.find(i => i.sku === li.sku);
            return s + (li.costPrice || (item ? itemCostTRY(item, exchangeRates) : 0)) * (li.quantity || 1);
          }, 0);
          monthCOGS[key] = (monthCOGS[key] || 0) + (cogs || (o.totalPrice || 0) * 0.55);
        });
        const keys348 = Object.keys(monthCOGS).sort().slice(-8);
        if (keys348.length < 3) return null;
        const maxCOGS = Math.max(...keys348.map(k => monthCOGS[k]), 1);
        const totalCOGS = keys348.reduce((s, k) => s + monthCOGS[k], 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Aylık Satılan Malın Maliyeti Eğilimi' : 'Monthly COGS Trend'}</h3>
            <p className="text-xs text-gray-500 mb-4">Cost of Goods Sold · {keys348.length}-month total: {fmtAna(totalCOGS,'full',0)}</p>
            <div className="flex items-end gap-2 h-24">
              {keys348.map(k => (
                <div key={k} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-t-lg bg-orange-400 transition-all" style={{height: `${Math.max((monthCOGS[k] / maxCOGS) * 72, 4)}px`}} />
                  <span className="text-[9px] text-gray-400">{k.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const marginData = inventory
          .filter(item => item.costPrice > 0 && (item.prices?.['Retail'] || item.price || 0) > 0)
          .map(item => {
            const sell = item.prices?.['Retail'] || item.price || 0;
            const cost = item.costPrice;
            const margin = sell > 0 ? ((sell - cost) / sell) * 100 : 0;
            return { name: item.name, margin, sell, cost, stock: item.stockLevel };
          })
          .filter(d => d.margin < 40)
          .sort((a, b) => a.margin - b.margin)
          .slice(0, 8);
        if (marginData.length < 2) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Düşük Marjlı Ürünler' : 'Low Margin Products'}</h3>
            <p className="text-xs text-gray-500 mb-4">Items with gross margin below 40% — review pricing or costs</p>
            <div className="space-y-2">
              {marginData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width: `${Math.max(d.margin, 0)}%`, background: d.margin < 10 ? '#ef4444' : d.margin < 20 ? '#f97316' : '#f59e0b'}} />
                  </div>
                  <span className="text-xs font-bold w-12 text-right" style={{color: d.margin < 10 ? '#ef4444' : d.margin < 20 ? '#f97316' : '#f59e0b'}}>{d.margin.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 6 && (() => {
        const scatterData = inventory
          .filter(i => itemCostTRY(i, exchangeRates) > 0 && (i.prices?.['Retail'] || i.price || 0) > 0)
          .map(i => ({
            name: i.name,
            cost: itemCostTRY(i, exchangeRates),
            sell: itemPriceTRY(i, 'Retail', exchangeRates) || i.price || 0,
            margin: ((( i.prices?.['Retail'] || i.price || 0) - itemCostTRY(i, exchangeRates)) / (i.prices?.['Retail'] || i.price || 1)) * 100,
          }))
          .sort((a, b) => b.sell - a.sell)
          .slice(0, 10);
        if (scatterData.length < 3) return null;
        const maxSell = Math.max(...scatterData.map(d => d.sell), 1);
        const avgMargin = scatterData.reduce((s, d) => s + d.margin, 0) / scatterData.length;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Cost vs Sell Price — Top 10 SKUs</h3>
            <p className="text-xs text-gray-500 mb-4">Avg margin: <span className="font-bold">{avgMargin.toFixed(1)}%</span> · width = sell price, fill = margin%</p>
            <div className="space-y-1.5">
              {scatterData.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-28 truncate">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full absolute left-0" style={{width: `${(d.sell / maxSell) * 100}%`, background: '#e5e7eb'}} />
                    <div className="h-full rounded-full absolute left-0" style={{width: `${(d.cost / maxSell) * 100}%`, background: d.margin < 20 ? '#ef4444' : d.margin < 40 ? '#f59e0b' : '#10b981'}} />
                  </div>
                  <span className="text-[10px] font-bold w-10 text-right" style={{color: d.margin < 20 ? '#ef4444' : d.margin < 40 ? '#f59e0b' : '#10b981'}}>{d.margin.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const toTs358 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const now358 = Date.now();
        const lastSale358: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const ts = toTs358(m.timestamp);
          const key = m.productName || '';
          if (key && (!lastSale358[key] || ts > lastSale358[key])) lastSale358[key] = ts;
        });
        const deadStock = inventory
          .filter(item => {
            if (item.stockLevel <= 0) return false;
            const lastTs = lastSale358[item.name];
            const daysSince = lastTs ? Math.floor((now358 - lastTs) / 86400000) : 999;
            return daysSince > 180;
          })
          .map(item => {
            const lastTs = lastSale358[item.name];
            const days = lastTs ? Math.floor((now358 - lastTs) / 86400000) : 999;
            return { name: item.name, stock: item.stockLevel, value: item.stockLevel * itemCostTRY(item, exchangeRates), days };
          })
          .sort((a, b) => b.value - a.value)
          .slice(0, 7);
        if (deadStock.length < 2) return null;
        const totalDeadValue = deadStock.reduce((s, d) => s + d.value, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ölü Stok Raporu' : 'Dead Stock Report'}</h3>
            <p className="text-xs text-gray-500 mb-4">No sales in 180+ days · Locked capital: {fmtAna(totalDeadValue,'full',0)}</p>
            <div className="space-y-2">
              {deadStock.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 flex-1 truncate">{d.name}</span>
                  <span className="text-[10px] text-gray-400 w-16 text-right">{d.days === 999 ? 'Never sold' : `${d.days}d ago`}</span>
                  <span className="text-[10px] text-gray-500 w-12 text-right">{d.stock} units</span>
                  <span className="text-xs font-bold text-red-500 w-24 text-right">{fmtAna(d.value,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const inMoves = inventoryMovements.filter(m => m.type === 'in');
        const reorderCount: Record<string, number> = {};
        inMoves.forEach(m => { reorderCount[m.productName || 'Unknown'] = (reorderCount[m.productName || 'Unknown'] || 0) + 1; });
        const reorderData = Object.entries(reorderCount).map(([name, count]) => ({name, count})).filter(d => d.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);
        if (reorderData.length < 2) return null;
        const maxCount364 = Math.max(...reorderData.map(d => d.count), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'En Sık Tekrar Sipariş Edilenler' : 'Most Frequently Reordered'}</h3>
            <p className="text-xs text-gray-500 mb-4">Products with most inbound stock movements</p>
            <div className="space-y-2">
              {reorderData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{d.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-cyan-400 transition-all" style={{width: `${(d.count / maxCount364) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-cyan-600 w-10 text-right">{d.count}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const toTs368 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const cutoff = Date.now() - 30 * 86400000;
        const recentOut: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out' && toTs368(m.timestamp) > cutoff)
          .forEach(m => { recentOut[m.productName || 'Unknown'] = (recentOut[m.productName || 'Unknown'] || 0) + (m.quantity || 0); });
        const velocityData = Object.entries(recentOut).map(([sku, qty]) => ({sku, qty})).sort((a, b) => b.qty - a.qty).slice(0, 8);
        if (velocityData.length < 2) return null;
        const maxQty368 = Math.max(...velocityData.map(d => d.qty), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">SKU Velocity (Last 30 Days)</h3>
            <p className="text-xs text-gray-500 mb-4">Units moved out in the past 30 days — fastest moving SKUs</p>
            <div className="space-y-2">
              {velocityData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate">{d.sku}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-rose-400 transition-all" style={{width: `${(d.qty / maxQty368) * 100}%`}} />
                  </div>
                  <span className="text-xs font-bold text-rose-500 w-14 text-right">{d.qty} units</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 6 && (() => {
        const itemsWithRev = inventory.map(item => {
          const sold = inventoryMovements.filter(m => m.type === 'out' && m.productName === item.name).reduce((s, m) => s + (m.quantity || 0), 0);
          const rev = sold * (item.prices?.['Retail'] || item.price || 0);
          return {name: item.name, rev, stock: item.stockLevel, cost: item.costPrice};
        }).filter(d => d.rev > 0 || d.stock > 0).sort((a, b) => b.rev - a.rev);
        if (itemsWithRev.length < 4) return null;
        const totalRev374 = itemsWithRev.reduce((s, d) => s + d.rev, 0);
        let cumRev = 0;
        const classified = itemsWithRev.map(d => {
          cumRev += d.rev;
          const cumPct = totalRev374 > 0 ? (cumRev / totalRev374) * 100 : 0;
          return {...d, class: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C'};
        });
        const counts = {A: classified.filter(d => d.class === 'A').length, B: classified.filter(d => d.class === 'B').length, C: classified.filter(d => d.class === 'C').length};
        const classColors: Record<string, string> = {A: '#10b981', B: '#f59e0b', C: '#ef4444'};
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'ABC Stok Analizi' : 'ABC Inventory Analysis'}</h3>
            <p className="text-xs text-gray-500 mb-4">A = top 80% revenue · B = next 15% · C = bottom 5%</p>
            <div className="flex gap-4 mb-4">
              {(['A','B','C'] as const).map(cls => (
                <div key={cls} className="flex-1 rounded-xl p-3 text-center" style={{background: classColors[cls] + '22'}}>
                  <p className="text-xl font-black" style={{color: classColors[cls]}}>{counts[cls]}</p>
                  <p className="text-[10px] font-bold" style={{color: classColors[cls]}}>Class {cls}</p>
                  <p className="text-[9px] text-gray-400">{itemsWithRev.length > 0 ? ((counts[cls] / itemsWithRev.length) * 100).toFixed(0) : 0}% of SKUs</p>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {classified.slice(0, 6).map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[9px] font-black w-4 text-center rounded" style={{color: classColors[d.class], background: classColors[d.class] + '22'}}>{d.class}</span>
                  <span className="text-[10px] text-gray-600 flex-1 truncate">{d.name}</span>
                  <span className="text-[10px] font-bold text-gray-500">{fmtAna(d.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && orders.length >= 5 && (() => {
        const skuRev: Record<string, {units: number; rev: number}> = {};
        orders.forEach(o => {
          (o.lineItems || []).forEach((li: {sku?: string; name?: string; quantity?: number; price?: number; unitPrice?: number}) => {
            const key = li.sku || li.name || 'Unknown';
            if (!skuRev[key]) skuRev[key] = {units: 0, rev: 0};
            skuRev[key].units += li.quantity || 1;
            skuRev[key].rev += (li.price || li.unitPrice || 0) * (li.quantity || 1);
          });
        });
        const skuData = Object.entries(skuRev).map(([sku, d]) => ({sku, ...d, revPerUnit: d.units > 0 ? d.rev / d.units : 0})).filter(d => d.units >= 2).sort((a, b) => b.rev - a.rev).slice(0, 8);
        if (skuData.length < 2) return null;
        const maxRev376 = Math.max(...skuData.map(d => d.rev), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'SKU Başına Ciro' : 'Revenue per SKU'}</h3>
            <p className="text-xs text-gray-500 mb-4">Top SKUs by total revenue generated from sales</p>
            <div className="space-y-2">
              {skuData.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{d.sku}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-400 transition-all" style={{width: `${(d.rev / maxRev376) * 100}%`}} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-12 text-right">{d.units} sold</span>
                  <span className="text-xs font-bold text-emerald-600 w-24 text-right">{fmtAna(d.rev,'full',0)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const toTs379 = (v: unknown): number => {
          if (!v) return 0;
          if (typeof (v as {toDate?:()=>Date}).toDate === 'function') return (v as {toDate:()=>Date}).toDate().getTime();
          return new Date(v as string|number).getTime();
        };
        const monthDelta: Record<string, number> = {};
        inventoryMovements.forEach(m => {
          const ts = toTs379(m.timestamp);
          if (!ts) return;
          const d = new Date(ts);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const item = inventory.find(i => i.name === m.productName);
          const cost = item?.costPrice || 0;
          const delta = (m.quantity || 0) * cost * (m.type === 'in' ? 1 : -1);
          monthDelta[key] = (monthDelta[key] || 0) + delta;
        });
        const keys379 = Object.keys(monthDelta).sort().slice(-7);
        if (keys379.length < 3) return null;
        const maxAbs = Math.max(...keys379.map(k => Math.abs(monthDelta[k])), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Aylık Stok Değeri Değişimi' : 'Monthly Stock Value Change'}</h3>
            <p className="text-xs text-gray-500 mb-4">Net inventory cost value added (+) or consumed (−)</p>
            <div className="flex items-center gap-2 h-28">
              {keys379.map(k => {
                const val = monthDelta[k];
                const h = Math.max((Math.abs(val) / maxAbs) * 56, 4);
                return (
                  <div key={k} className="flex-1 flex flex-col items-center" style={{height: '112px', justifyContent: 'center'}}>
                    {val >= 0 ? (
                      <>
                        <div className="w-full rounded-t-lg bg-emerald-400" style={{height: `${h}px`}} />
                        <div className="w-full h-px bg-gray-200" />
                        <div className="w-full" style={{height: '56px'}} />
                      </>
                    ) : (
                      <>
                        <div className="w-full" style={{height: '56px'}} />
                        <div className="w-full h-px bg-gray-200" />
                        <div className="w-full rounded-b-lg bg-red-400" style={{height: `${h}px`}} />
                      </>
                    )}
                    <span className="text-[9px] text-gray-400 mt-0.5">{k.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const now = new Date();
        const lastMove: Record<string, Date> = {};
        inventoryMovements.forEach(m => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.() ?? new Date(m.date as string)) : null;
          if (!d) return;
          const pid = m.productId as string;
          if (!lastMove[pid] || d > lastMove[pid]) lastMove[pid] = d;
        });
        const slowMovers = inventory
          .map(item => ({
            name: item.name,
            sku: item.sku ?? '',
            stock: (item.stock as number | undefined) ?? 0,
            daysSince: lastMove[item.id] ? Math.floor((now.getTime() - lastMove[item.id].getTime()) / 86400000) : 999,
          }))
          .filter(i => i.daysSince >= 30 && i.stock > 0)
          .sort((a, b) => b.daysSince - a.daysSince)
          .slice(0, 8);
        if (slowMovers.length === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>⚠️ Slow-Mover Alert</span>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">{slowMovers.length} items</span>
            </h3>
            <div className="space-y-1.5">
              {slowMovers.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="ml-2 text-gray-400">×{String(item.stock)}</span>
                  <span className="ml-2 font-bold" style={{color: item.daysSince >= 90 ? '#ef4444' : item.daysSince >= 60 ? '#f59e0b' : '#6b7280'}}>{item.daysSince}d</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const atRisk = inventory
          .map(item => {
            const rp = (item.reorderPoint as number | undefined) ?? (item.lowStockThreshold as number | undefined) ?? 5;
            const stk = (item.stock as number | undefined) ?? 0;
            return { name: item.name, stock: stk, reorderPoint: rp, gap: rp - stk };
          })
          .filter(i => i.gap > 0)
          .sort((a, b) => b.gap - a.gap)
          .slice(0, 8);
        if (atRisk.length === 0) return (
          <div className="apple-card p-4 mb-4 flex items-center gap-2">
            <span className="text-green-500 text-lg">✓</span>
            <div>
              <p className="text-sm font-semibold text-green-700">All items above reorder point</p>
              <p className="text-xs text-gray-500">No restocking needed right now</p>
            </div>
          </div>
        );
        const maxGap = Math.max(...atRisk.map(i => i.gap), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🔴 Below Reorder Point</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{atRisk.length} items</span>
            </h3>
            <div className="space-y-2">
              {atRisk.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{item.name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(item.gap / maxGap) * 100}%`, background: '#ef4444'}} />
                  </div>
                  <span className="text-xs font-bold text-red-600 w-12 text-right">-{item.gap}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const catData: Record<string, {cost: number; retail: number; count: number}> = {};
        inventory.forEach(item => {
          const cat = item.category ?? 'Other';
          const retail = (item.prices?.['Retail'] as number | undefined) ?? (item.prices?.['B2B Standard'] as number | undefined) ?? 0;
          const cost = itemCostTRY(item, exchangeRates) || retail * 0.6;
          if (!catData[cat]) catData[cat] = {cost: 0, retail: 0, count: 0};
          catData[cat].retail += retail;
          catData[cat].cost += cost;
          catData[cat].count++;
        });
        const rows = Object.entries(catData)
          .map(([cat, d]) => ({ cat, margin: d.retail > 0 ? ((d.retail - d.cost) / d.retail) * 100 : 0, count: d.count }))
          .filter(r => r.margin > 0)
          .sort((a, b) => b.margin - a.margin)
          .slice(0, 6);
        if (rows.length < 2) return null;
        const maxM = Math.max(...rows.map(r => r.margin), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Kategori Kâr Marjı Analizi' : 'Category Margin Analysis'}</h3>
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.cat} className="flex items-center gap-2">
                  <span className="text-xs truncate w-24 text-gray-700">{r.cat}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(r.margin / maxM) * 100}%`, background: r.margin >= 40 ? '#22c55e' : r.margin >= 20 ? '#f59e0b' : '#ef4444'}}>
                      <span className="text-white text-[9px] font-bold">{r.margin.toFixed(0)}%</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-8 text-right">{r.count}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        let inStock = 0, lowStock = 0, outOfStock = 0;
        inventory.forEach(item => {
          const stk = (item.stock as number | undefined) ?? 0;
          const threshold = (item.reorderPoint as number | undefined) ?? (item.lowStockThreshold as number | undefined) ?? 5;
          if (stk === 0) outOfStock++;
          else if (stk <= threshold) lowStock++;
          else inStock++;
        });
        const total = inventory.length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Stok Sağlığı Özeti' : 'Inventory Health Summary'}</h3>
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              <div style={{width: `${(inStock/total)*100}%`, background: '#22c55e'}} />
              <div style={{width: `${(lowStock/total)*100}%`, background: '#f59e0b'}} />
              <div style={{width: `${(outOfStock/total)*100}%`, background: '#ef4444'}} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[{label:'In Stock',count:inStock,color:'#22c55e'},{label:'Low',count:lowStock,color:'#f59e0b'},{label:'Out',count:outOfStock,color:'#ef4444'}].map(s => (
                <div key={s.label} className="rounded-xl p-2" style={{background: `${s.color}15`}}>
                  <p className="text-xl font-bold" style={{color: s.color}}>{s.count}</p>
                  <p className="text-[10px] text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 5 && (() => {
        const outByCategory: Record<string, number> = {};
        const stockByCategory: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const item = inventory.find(i => i.id === (m.productId as string));
          if (!item) return;
          const cat = item.category ?? 'Other';
          outByCategory[cat] = (outByCategory[cat] ?? 0) + (m.quantity ?? 0);
        });
        inventory.forEach(item => {
          const cat = item.category ?? 'Other';
          stockByCategory[cat] = (stockByCategory[cat] ?? 0) + ((item.stock as number | undefined) ?? 0);
        });
        const rows = Object.keys(outByCategory)
          .map(cat => ({ cat, turnover: stockByCategory[cat] > 0 ? outByCategory[cat] / stockByCategory[cat] : 0 }))
          .filter(r => r.turnover > 0)
          .sort((a, b) => b.turnover - a.turnover)
          .slice(0, 6);
        if (rows.length < 2) return null;
        const maxT = Math.max(...rows.map(r => r.turnover), 1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Kategoriye Göre Stok Devir Hızı' : 'Stock Turnover by Category'}</h3>
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.cat} className="flex items-center gap-2">
                  <span className="text-xs truncate w-24 text-gray-700">{r.cat}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(r.turnover / maxT) * 100}%`, background: r.turnover >= 2 ? '#22c55e' : r.turnover >= 1 ? '#f59e0b' : '#ef4444'}}>
                      <span className="text-white text-[9px] font-bold">{r.turnover.toFixed(1)}×</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const catValue: Record<string, number> = {};
        inventory.forEach(item => {
          const cat = item.category ?? 'Other';
          const retail = (item.prices?.['Retail'] as number | undefined) ?? 0;
          const stk = (item.stock as number | undefined) ?? 0;
          catValue[cat] = (catValue[cat] ?? 0) + retail * stk;
        });
        const total = Object.values(catValue).reduce((a,b) => a+b, 0);
        if (total === 0) return null;
        const rows = Object.entries(catValue).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const others = total - rows.reduce((s, [,v]) => s + v, 0);
        if (others > 0) rows.push(['Other', others]);
        const palette = ['#ff4000','#3b82f6','#22c55e','#f59e0b','#8b5cf6','#6b7280'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Kategoriye Göre Stok Değeri' : 'Inventory Value by Category'}</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([cat, val], i) => (
                <div key={cat} style={{width: `${(val/total)*100}%`, background: palette[i]}} title={cat} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {rows.map(([cat, val], i) => (
                <div key={cat} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: palette[i]}} />
                  <span className="text-gray-600 truncate">{cat}</span>
                  <span className="ml-auto font-medium text-gray-800">{Math.round((val/total)*100)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && (() => {
        const products = inventory
          .map(item => {
            const retail = (item.prices?.['Retail'] as number | undefined) ?? 0;
            const cost = itemCostTRY(item, exchangeRates) || retail * 0.6;
            const stk = (item.stock as number | undefined) ?? 0;
            const margin = retail > 0 ? ((retail - cost) / retail) * 100 : 0;
            const potentialProfit = (retail - cost) * stk;
            return { name: item.name, margin, potentialProfit, retail, stock: stk };
          })
          .filter(p => p.margin > 0 && p.stock > 0)
          .sort((a, b) => b.potentialProfit - a.potentialProfit)
          .slice(0, 7);
        if (products.length < 2) return null;
        const maxProfit = products[0].potentialProfit;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Potansiyel Kâra Göre En İyi Ürünler' : 'Top Products by Potential Profit'}</h3>
            <div className="space-y-2">
              {products.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs truncate flex-1 text-gray-700">{p.name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(p.potentialProfit / maxProfit) * 100}%`, background: '#22c55e'}} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-10 text-right">{p.margin.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 5 && (() => {
        const outPerMonth: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          outPerMonth[m.productId as string] = (outPerMonth[m.productId as string] ?? 0) + (m.quantity ?? 0);
        });
        const now = new Date();
        const oldestMove = inventoryMovements.reduce((oldest, m) => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.() ?? new Date(m.date as string)) : null;
          if (!d) return oldest;
          return d < oldest ? d : oldest;
        }, now);
        const monthsCovered = Math.max((now.getTime() - oldestMove.getTime()) / (30 * 86400000), 1);
        const overstocked = inventory
          .map(item => {
            const monthlyOut = (outPerMonth[item.id] ?? 0) / monthsCovered;
            const stk = (item.stock as number | undefined) ?? 0;
            const monthsOfStock = monthlyOut > 0 ? stk / monthlyOut : stk > 0 ? 999 : 0;
            return { name: item.name, stock: stk, monthlyOut, monthsOfStock };
          })
          .filter(i => i.monthsOfStock >= 6 && i.stock > 0)
          .sort((a, b) => b.monthsOfStock - a.monthsOfStock)
          .slice(0, 6);
        if (overstocked.length === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>📦 Overstock Alert</span>
              <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">{overstocked.length} items</span>
            </h3>
            <div className="space-y-1.5">
              {overstocked.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 mx-2">×{item.stock}</span>
                  <span className="font-bold text-orange-600">{item.monthsOfStock >= 999 ? '∞' : `${item.monthsOfStock.toFixed(0)}mo`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const catCount: Record<string, {items: number; totalStock: number; totalValue: number}> = {};
        inventory.forEach(item => {
          const cat = item.category ?? 'Other';
          if (!catCount[cat]) catCount[cat] = {items: 0, totalStock: 0, totalValue: 0};
          catCount[cat].items++;
          const stk = (item.stock as number|undefined) ?? 0;
          const price = (item.prices?.['Retail'] as number|undefined) ?? 0;
          catCount[cat].totalStock += stk;
          catCount[cat].totalValue += price * stk;
        });
        const rows = Object.entries(catCount).sort((a, b) => b[1].items - a[1].items);
        if (rows.length < 2) return null;
        const maxItems = rows[0][1].items;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Kategori Başına SKU' : 'SKUs per Category'}</h3>
            <div className="space-y-2">
              {rows.map(([cat, d]) => (
                <div key={cat} className="flex items-center gap-2">
                  <span className="text-xs truncate w-20 text-gray-700">{cat}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(d.items / maxItems) * 100}%`, background: '#0ea5e9'}}>
                      <span className="text-white text-[9px] font-bold">{d.items}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-12 text-right">×{d.totalStock}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const soldIds = new Set(inventoryMovements.filter(m => m.type === 'out').map(m => m.productId as string));
        const neverSold = inventory.filter(item => !soldIds.has(item.id) && ((item.stock as number|undefined) ?? 0) > 0);
        if (neverSold.length === 0) return null;
        const topNeverSold = neverSold
          .map(item => ({
            name: item.name,
            stock: (item.stock as number|undefined) ?? 0,
            value: ((item.prices?.['Retail'] as number|undefined) ?? 0) * ((item.stock as number|undefined) ?? 0),
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);
        const totalValue = topNeverSold.reduce((s, i) => s + i.value, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🚫 Never Sold Items</span>
              <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">{neverSold.length}</span>
            </h3>
            <div className="space-y-1.5">
              {topNeverSold.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 mx-2">×{item.stock}</span>
                  <span className="text-gray-600">{fmtAna(item.value,'full',0)}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-right">Total tied-up: {fmtAna(totalValue,'full',0)}</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const outCounts: Record<string, number> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          outCounts[m.productId as string] = (outCounts[m.productId as string] ?? 0) + (m.quantity ?? 0);
        });
        const top = Object.entries(outCounts)
          .map(([id, qty]) => ({ id, qty, name: inventory.find(i => i.id === id)?.name ?? id }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 7);
        if (top.length < 2) return null;
        const maxQty = top[0].qty;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Top Products by Movement (Out)</h3>
            <div className="space-y-2">
              {top.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs truncate flex-1 text-gray-700">{p.name}</span>
                  <div className="w-20 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${(p.qty / maxQty) * 100}%`, background: '#22c55e'}} />
                  </div>
                  <span className="text-xs font-bold text-green-600 w-8 text-right">{p.qty}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const tiers = ['Retail','B2B Standard','B2B Premium','Dealer'] as const;
        const tierCounts = tiers.map(t => ({
          tier: t,
          count: inventory.filter(item => (item.prices?.[t] as number|undefined) != null && ((item.prices?.[t] as number)??0) > 0).length,
          avgPrice: (() => {
            const prices = inventory.map(i => (i.prices?.[t] as number|undefined)).filter((p): p is number => p != null && p > 0);
            return prices.length > 0 ? prices.reduce((a,b)=>a+b,0)/prices.length : 0;
          })(),
        }));
        const maxCount = Math.max(...tierCounts.map(t=>t.count), 1);
        const colors = ['#ff4000','#3b82f6','#22c55e','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Kademeye Göre Fiyatlı SKU\'lar' : 'SKUs with Pricing by Tier'}</h3>
            <div className="space-y-2">
              {tierCounts.map((t, i) => (
                <div key={t.tier} className="flex items-center gap-2">
                  <span className="text-[10px] truncate w-20 text-gray-600">{t.tier}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width: `${(t.count/maxCount)*100}%`, background: colors[i]}}>
                      <span className="text-white text-[9px] font-bold">{t.count > 0 ? t.count : ''}</span>
                    </div>
                  </div>
                  {t.avgPrice > 0 && <span className="text-[9px] text-gray-400 w-14 text-right">avg {fmtAna(t.avgPrice,'full',0)}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && inventoryMovements.length >= 3 && (() => {
        const now = new Date();
        const outPerProduct: Record<string, {qty: number; days: number}> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.() ?? new Date(m.date as string)) : null;
          if (!d) return;
          const pid = m.productId as string;
          const daysSince = (now.getTime() - d.getTime()) / 86400000;
          if (!outPerProduct[pid]) outPerProduct[pid] = {qty: 0, days: 30};
          outPerProduct[pid].qty += m.quantity ?? 0;
          outPerProduct[pid].days = Math.max(outPerProduct[pid].days, daysSince);
        });
        const replenishment = inventory
          .map(item => {
            const out = outPerProduct[item.id];
            const stk = (item.stock as number|undefined) ?? 0;
            if (!out || out.qty === 0) return null;
            const dailyRate = out.qty / Math.max(out.days, 1);
            const daysOfStock = dailyRate > 0 ? stk / dailyRate : 999;
            return {name: item.name, daysOfStock, stock: stk, dailyRate};
          })
          .filter((i): i is NonNullable<typeof i> => i !== null && i.daysOfStock <= 14 && i.stock > 0)
          .sort((a,b) => a.daysOfStock - b.daysOfStock)
          .slice(0, 6);
        if (replenishment.length === 0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🔄 Replenishment Due Soon</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{replenishment.length}</span>
            </h3>
            <div className="space-y-2">
              {replenishment.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-gray-400 mx-2">×{item.stock}</span>
                  <span className="font-bold" style={{color: item.daysOfStock <= 3 ? '#ef4444' : item.daysOfStock <= 7 ? '#f59e0b' : '#6b7280'}}>
                    {item.daysOfStock.toFixed(0)}d left
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && orders.length >= 3 && (() => {
        const productRevenue: Record<string, number> = {};
        orders.forEach(o => {
          (o.lineItems??[]).forEach(li => {
            const lr = li as unknown as Record<string,unknown>;
            const pid = (lr.productId as string|undefined) ?? (lr.id as string|undefined) ?? '';
            const name = (lr.productName as string|undefined) ?? (lr.name as string|undefined) ?? '';
            const qty = (lr.quantity as number|undefined)??0;
            const price = (lr.unitPrice as number|undefined)??(lr.price as number|undefined)??0;
            const key = pid || name;
            if (key) productRevenue[key] = (productRevenue[key]??0)+qty*price;
          });
        });
        const invRevenue = inventory.map(item => ({
          cat: item.category ?? 'Other',
          rev: productRevenue[item.id] ?? productRevenue[item.name] ?? 0,
        }));
        const catRev: Record<string,number> = {};
        invRevenue.forEach(({cat,rev}) => { catRev[cat]=(catRev[cat]??0)+rev; });
        const rows = Object.entries(catRev).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (rows.length < 2) return null;
        const totalRev = rows.reduce((s,[,v])=>s+v,0);
        const palette=['#ff4000','#3b82f6','#22c55e','#f59e0b','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Siparişlerden Kategori Cirosu' : 'Category Revenue from Orders'}</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              {rows.map(([cat,rev],i)=><div key={cat} style={{width:`${(rev/totalRev)*100}%`,background:palette[i]}} title={cat} />)}
            </div>
            <div className="space-y-1.5">
              {rows.map(([cat,rev],i)=>(
                <div key={cat} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:palette[i]}} />
                  <span className="text-xs truncate flex-1 text-gray-700">{cat}</span>
                  <span className="text-xs font-bold">{fmtAna(rev,'K',1)}</span>
                  <span className="text-[9px] text-gray-400 w-8 text-right">{Math.round((rev/totalRev)*100)}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const byMonth: Record<string,{in:number;out:number}> = {};
        inventoryMovements.forEach(m => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!byMonth[key]) byMonth[key]={in:0,out:0};
          if (m.type==='in') byMonth[key].in+=(m.quantity??0);
          else byMonth[key].out+=(m.quantity??0);
        });
        const months = Object.keys(byMonth).sort().slice(-6);
        if (months.length < 2) return null;
        const maxVal = Math.max(...months.flatMap(m=>[byMonth[m].in,byMonth[m].out]),1);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aya Göre Stok Giriş/Çıkış' : 'Inventory In vs Out by Month'}</h3>
            <div className="flex items-end gap-2 h-24 mb-1">
              {months.map(m=>(
                <div key={m} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].in/maxVal)*72}px`,background:'#22c55e',minHeight:byMonth[m].in>0?2:0}} />
                  <div className="flex-1 rounded-sm" style={{height:`${(byMonth[m].out/maxVal)*72}px`,background:'#ef4444',minHeight:byMonth[m].out>0?2:0}} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-2">
              {months.map(m=><span key={m} className="flex-1 text-center text-[9px] text-gray-400">{m.slice(5)}</span>)}
            </div>
            <div className="flex gap-3 justify-center text-[10px]">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"/><span className="text-gray-500">In</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"/><span className="text-gray-500">Out</span></div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const now = new Date();
        const d30 = new Date(now.getTime()-30*86400000);
        let totalIn=0,totalOut=0,totalIn30=0,totalOut30=0;
        inventoryMovements.forEach(m => {
          const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)) : null;
          if (m.type==='in') { totalIn+=(m.quantity??0); if(d&&d>=d30) totalIn30+=(m.quantity??0); }
          else { totalOut+=(m.quantity??0); if(d&&d>=d30) totalOut30+=(m.quantity??0); }
        });
        const netAllTime = totalIn - totalOut;
        const net30 = totalIn30 - totalOut30;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Stok Hareketi Özeti' : 'Inventory Movement Summary'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-gray-500 mb-2">All Time</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-green-600">In</span><span className="font-bold">{totalIn.toLocaleString('tr-TR')}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-red-500">Out</span><span className="font-bold">{totalOut.toLocaleString('tr-TR')}</span></div>
                  <div className="flex justify-between text-xs border-t pt-1"><span className="text-gray-600">Net</span><span className="font-bold" style={{color:netAllTime>=0?'#22c55e':'#ef4444'}}>{netAllTime>=0?'+':''}{netAllTime.toLocaleString('tr-TR')}</span></div>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 mb-2">Last 30 Days</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-green-600">In</span><span className="font-bold">{totalIn30.toLocaleString('tr-TR')}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-red-500">Out</span><span className="font-bold">{totalOut30.toLocaleString('tr-TR')}</span></div>
                  <div className="flex justify-between text-xs border-t pt-1"><span className="text-gray-600">Net</span><span className="font-bold" style={{color:net30>=0?'#22c55e':'#ef4444'}}>{net30>=0?'+':''}{net30.toLocaleString('tr-TR')}</span></div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        let totalCost=0, totalRetail=0, count=0;
        inventory.forEach(item => {
          const retail = (item.prices?.['Retail'] as number|undefined)??0;
          const cost = itemCostTRY(item, exchangeRates)||retail*0.6;
          const stk = (item.stock as number|undefined)??0;
          if (retail>0 && stk>0) { totalRetail+=retail*stk; totalCost+=cost*stk; count++; }
        });
        if (totalRetail===0) return null;
        const overallMargin = totalRetail>0 ? ((totalRetail-totalCost)/totalRetail)*100 : 0;
        const profitPotential = totalRetail - totalCost;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Stok Maliyeti ve Perakende Değeri' : 'Inventory Cost vs Retail Value'}</h3>
            <div className="relative h-8 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div className="absolute inset-y-0 left-0 rounded-full" style={{width:`${(totalCost/totalRetail)*100}%`,background:'#6b7280'}} />
              <div className="absolute inset-y-0 rounded-full" style={{left:`${(totalCost/totalRetail)*100}%`,right:0,background:'#22c55e'}} />
              <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">{overallMargin.toFixed(1)}% margin</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl p-2 bg-gray-50"><p className="font-bold">{fmtAna(totalCost,'K',0)}</p><p className="text-gray-400">Cost</p></div>
              <div className="rounded-xl p-2 bg-green-50"><p className="font-bold text-green-600">{fmtAna(profitPotential,'K',0)}</p><p className="text-gray-400">Profit</p></div>
              <div className="rounded-xl p-2 bg-blue-50"><p className="font-bold text-blue-600">{fmtAna(totalRetail,'K',0)}</p><p className="text-gray-400">Retail</p></div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 3 && (() => {
        const recentIn = inventoryMovements
          .filter(m=>m.type==='in')
          .map(m=>{
            const d = m.date ? ((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)) : null;
            return {
              ...m,
              date2: d,
              productName: inventory.find(i=>i.id===(m.productId as string))?.name ?? (m.productId as string),
            };
          })
          .filter(m=>m.date2!==null)
          .sort((a,b)=>b.date2!.getTime()-a.date2!.getTime())
          .slice(0,8);
        if (recentIn.length===0) return null;
        const totalQty = recentIn.reduce((s,m)=>s+(m.quantity??0),0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>📥 Recent Stock Inflows</span>
              <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">+{totalQty} units</span>
            </h3>
            <div className="space-y-1.5">
              {recentIn.map((m,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{m.productName}</span>
                  <span className="text-green-600 font-bold ml-2">+{m.quantity??0}</span>
                  <span className="text-gray-400 ml-2">{m.date2!.toLocaleDateString('tr-TR',{day:'2-digit',month:'short'})}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 5 && (() => {
        const now = new Date();
        const outByProduct: Record<string,number> = {};
        inventoryMovements.filter(m=>m.type==='out').forEach(m=>{ outByProduct[m.productId as string]=(outByProduct[m.productId as string]??0)+(m.quantity??0); });
        const oldestMove = inventoryMovements.reduce((oldest,m)=>{ const d=m.date?((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)):null; return (d&&d<oldest)?d:oldest; },now);
        const months = Math.max((now.getTime()-oldestMove.getTime())/(30*86400000),1);
        const deficit = inventory
          .filter(item=>((item.stock as number|undefined)??0)===0)
          .map(item=>({
            name: item.name,
            demandPerMonth: (outByProduct[item.id]??0)/months,
          }))
          .filter(i=>i.demandPerMonth>0)
          .sort((a,b)=>b.demandPerMonth-a.demandPerMonth)
          .slice(0,6);
        if (deficit.length===0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>🚨 Out of Stock with Demand</span>
              <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">{deficit.length}</span>
            </h3>
            <div className="space-y-2">
              {deficit.map((item,i)=>(
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1 text-gray-700">{item.name}</span>
                  <span className="text-red-600 font-bold ml-2">{item.demandPerMonth.toFixed(1)}/mo demand</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const locationCounts: Record<string,{count:number;totalStock:number}> = {};
        inventory.forEach(item => {
          const itemR = item as unknown as Record<string,unknown>;
          const loc = (itemR.location as string|undefined)??(itemR.warehouse as string|undefined)??(itemR.bin as string|undefined)??(itemR.shelf as string|undefined)??'Unassigned';
          if (!locationCounts[loc]) locationCounts[loc]={count:0,totalStock:0};
          locationCounts[loc].count++;
          locationCounts[loc].totalStock+=((item.stock as number|undefined)??0);
        });
        const rows = Object.entries(locationCounts).sort((a,b)=>b[1].count-a[1].count);
        if (rows.length<=1) {
          const totalItems=inventory.length;
          const totalStock=inventory.reduce((s,i)=>s+((i.stock as number|undefined)??0),0);
          return (
            <div className="apple-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Stok Toplamları' : 'Inventory Totals'}</h3>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl p-3 bg-blue-50"><p className="text-2xl font-bold text-blue-600">{totalItems}</p><p className="text-[10px] text-gray-500">SKUs</p></div>
                <div className="rounded-xl p-3 bg-green-50"><p className="text-2xl font-bold text-green-600">{totalStock.toLocaleString('tr-TR')}</p><p className="text-[10px] text-gray-500">Total Units</p></div>
              </div>
            </div>
          );
        }
        const maxCount=rows[0][1].count;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Depo Konumuna Göre Ürünler' : 'Items by Storage Location'}</h3>
            <div className="space-y-2">
              {rows.map(([loc,d])=>(
                <div key={loc} className="flex items-center gap-2">
                  <span className="text-xs truncate w-24 text-gray-700">{loc}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full rounded-full flex items-center pl-2" style={{width:`${(d.count/maxCount)*100}%`,background:'#0ea5e9'}}>
                      <span className="text-white text-[9px] font-bold">{d.count}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-10 text-right">×{d.totalStock}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const withExpiry = inventory.filter(item=>{ const ir=item as unknown as Record<string,unknown>; return !!(ir.expiryDate||ir.expiry||ir.bestBefore); });
        const withBarcode = inventory.filter(item=>{ const ir=item as unknown as Record<string,unknown>; return !!(ir.barcode||ir.ean||ir.upc||item.sku); });
        const withCost = inventory.filter(item=>{ return !!(item as unknown as Record<string,unknown>).costPrice; });
        const withImages = inventory.filter(item=>{ const ir=item as unknown as Record<string,unknown>; return !!(ir.imageUrl||ir.images||ir.photo); });
        const total=inventory.length;
        const fields=[
          {label:'Has SKU/Barcode',count:withBarcode.length,color:'#3b82f6'},
          {label:'Has Cost Price',count:withCost.length,color:'#22c55e'},
          {label:'Has Expiry',count:withExpiry.length,color:'#f59e0b'},
          {label:'Has Images',count:withImages.length,color:'#8b5cf6'},
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Stok Verisi Eksiksizliği' : 'Inventory Data Completeness'}</h3>
            <div className="space-y-2">
              {fields.map(f=>(
                <div key={f.label} className="flex items-center gap-2">
                  <span className="text-xs truncate w-28 text-gray-600">{f.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${total>0?(f.count/total)*100:0}%`,background:f.color}}/>
                  </div>
                  <span className="text-[10px] text-gray-500 w-8 text-right">{total>0?Math.round((f.count/total)*100):0}%</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-right">{total} total SKUs</p>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventoryMovements.length >= 5 && (() => {
        const eventCount: Record<string,{events:number;qty:number}> = {};
        inventoryMovements.forEach(m=>{
          const pid=m.productId as string;
          if(!eventCount[pid]) eventCount[pid]={events:0,qty:0};
          eventCount[pid].events++;
          eventCount[pid].qty+=(m.quantity??0);
        });
        const top=Object.entries(eventCount).sort((a,b)=>b[1].events-a[1].events).slice(0,7);
        if(top.length<2) return null;
        const maxEvents=top[0][1].events;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'En Hareketli Ürünler' : 'Most Active Products'}</h3>
            <div className="space-y-2">
              {top.map(([pid,d])=>{
                const name=inventory.find(i=>i.id===pid)?.name??pid;
                return (
                  <div key={pid} className="flex items-center gap-2">
                    <span className="text-xs truncate flex-1 text-gray-700">{name}</span>
                    <div className="w-16 bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div className="h-full rounded-full" style={{width:`${(d.events/maxEvents)*100}%`,background:'#0ea5e9'}}/>
                    </div>
                    <span className="text-[10px] text-gray-500 w-10 text-right">{d.events} ev</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && (() => {
        const now=new Date();
        let expiredValue=0,nearExpiryValue=0,healthyValue=0;
        const in30=new Date(now.getTime()+30*86400000);
        inventory.forEach(item=>{
          const itemR=item as unknown as Record<string,unknown>;
          const expStr=(itemR.expiryDate as string|undefined)??(itemR.expiry as string|undefined)??(itemR.bestBefore as string|undefined);
          const retail=(item.prices?.['Retail'] as number|undefined)??0;
          const stk=(item.stock as number|undefined)??0;
          const val=retail*stk;
          if(!expStr) { healthyValue+=val; return; }
          const expDate=new Date(expStr);
          if(expDate<now) expiredValue+=val;
          else if(expDate<in30) nearExpiryValue+=val;
          else healthyValue+=val;
        });
        const total=expiredValue+nearExpiryValue+healthyValue;
        if(total===0) return null;
        const hasExpiryData=expiredValue+nearExpiryValue>0;
        if(!hasExpiryData) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Stock Value at Risk (Expiry)</h3>
            <div className="flex h-4 rounded-full overflow-hidden mb-3">
              <div style={{width:`${(expiredValue/total)*100}%`,background:'#ef4444'}}/>
              <div style={{width:`${(nearExpiryValue/total)*100}%`,background:'#f59e0b'}}/>
              <div style={{width:`${(healthyValue/total)*100}%`,background:'#22c55e'}}/>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              {[{label:'Expired',val:expiredValue,color:'#ef4444'},{label:'<30d',val:nearExpiryValue,color:'#f59e0b'},{label:'Healthy',val:healthyValue,color:'#22c55e'}].map(s=>(
                <div key={s.label} className="rounded-xl p-2" style={{background:`${s.color}10`}}>
                  <p className="font-bold" style={{color:s.color}}>{fmtAna(s.val,'K',0)}</p>
                  <p className="text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && inventoryMovements.length >= 5 && (() => {
        const now=new Date();
        const outRates: Record<string,number>={};
        const oldest=inventoryMovements.reduce((o,m)=>{ const d=m.date?((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)):null; return (d&&d<o)?d:o; },now);
        const months=Math.max((now.getTime()-oldest.getTime())/(30*86400000),1);
        inventoryMovements.filter(m=>m.type==='out').forEach(m=>{ outRates[m.productId as string]=(outRates[m.productId as string]??0)+(m.quantity??0)/months; });
        const forecast=inventory
          .map(item=>{
            const rate=outRates[item.id]??0;
            const stk=(item.stock as number|undefined)??0;
            const rp=(item.reorderPoint as number|undefined)??(item.lowStockThreshold as number|undefined)??5;
            if(rate<=0||stk>rp) return null;
            const daysToStockout=rate>0?Math.floor(stk/rate*30):999;
            return {name:item.name,stock:stk,rate:rate.toFixed(1),days:daysToStockout};
          })
          .filter((i): i is NonNullable<typeof i>=>i!==null&&i.days<90)
          .sort((a,b)=>a.days-b.days)
          .slice(0,6);
        if(forecast.length===0) return null;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <span>📊 Reorder Forecast</span>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">{forecast.length} items</span>
            </h3>
            <div className="space-y-2">
              {forecast.map((item,i)=>(
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="text-xs text-gray-700">{item.name}</span>
                    <span className="text-[9px] text-gray-400 ml-2">×{item.stock} • {item.rate}/mo</span>
                  </div>
                  <span className="text-xs font-bold" style={{color:item.days<=14?'#ef4444':item.days<=30?'#f59e0b':'#6b7280'}}>
                    {item.days}d left
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 3 && inventoryMovements.length >= 5 && (() => {
        const now=new Date();
        const d30=new Date(now.getTime()-30*86400000);
        const recentOut=inventoryMovements.filter(m=>m.type==='out').filter(m=>{ const d=m.date?((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)):null; return d&&d>=d30; });
        const recentIn=inventoryMovements.filter(m=>m.type==='in').filter(m=>{ const d=m.date?((m.date as {toDate?:()=>Date}).toDate?.()??new Date(m.date as string)):null; return d&&d>=d30; });
        const totalOut=recentOut.reduce((s,m)=>s+(m.quantity??0),0);
        const totalIn=recentIn.reduce((s,m)=>s+(m.quantity??0),0);
        const fillRate=totalOut>0?Math.min(Math.round((totalIn/totalOut)*100),200):100;
        const inProducts=new Set(recentIn.map(m=>m.productId as string)).size;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Inventory Fill Rate (30d)</h3>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <p className="text-3xl font-bold" style={{color:fillRate>=100?'#22c55e':fillRate>=70?'#f59e0b':'#ef4444'}}>{fillRate}%</p>
                <p className="text-[10px] text-gray-500">in/out ratio</p>
              </div>
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-green-600">In (30d)</span><span className="font-bold">{totalIn} units</span></div>
                <div className="flex justify-between"><span className="text-red-500">Out (30d)</span><span className="font-bold">{totalOut} units</span></div>
                <div className="flex justify-between"><span className="text-gray-500">SKUs replenished</span><span className="font-bold">{inProducts}</span></div>
              </div>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'envanter' && inventory.length >= 5 && inventoryMovements.length >= 3 && (() => {
        const now = new Date();
        const lastSaleByProduct: Record<string, Date> = {};
        inventoryMovements.filter(m => m.type === 'out').forEach(m => {
          const d = (m.timestamp as {toDate?:()=>Date}).toDate?.() ?? new Date(m.timestamp as string);
          const key = m.productName || 'Unknown';
          if (!lastSaleByProduct[key] || d > lastSaleByProduct[key]) lastSaleByProduct[key] = d;
        });
        const tiers = [
          {label: 'Fresh (≤30d)', min: 0, max: 30, color: '#10b981'},
          {label: 'Active (31–90d)', min: 30, max: 90, color: '#3b82f6'},
          {label: 'Slow (91–180d)', min: 90, max: 180, color: '#f59e0b'},
          {label: 'Ageing (181–365d)', min: 180, max: 365, color: '#f97316'},
          {label: 'Dead (365d+)', min: 365, max: Infinity, color: '#ef4444'},
        ];
        const tierData = tiers.map(t => {
          const items = inventory.filter(item => {
            if (item.stockLevel <= 0) return false;
            const lastSale = lastSaleByProduct[item.name];
            const daysSince = lastSale ? Math.floor((now.getTime() - lastSale.getTime()) / 86400000) : 999;
            return daysSince >= t.min && daysSince < t.max;
          });
          return {
            ...t,
            count: items.length,
            value: items.reduce((s, i) => s + i.stockLevel * itemCostTRY(i, exchangeRates), 0),
          };
        });
        const totalValue = tierData.reduce((s, t) => s + t.value, 0);
        if (totalValue === 0) return null;
        const maxValue = Math.max(...tierData.map(t => t.value), 1);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Stok Yaşlandırma Piramidi' : 'Inventory Ageing Pyramid'}</h3>
            <p className="text-xs text-gray-500 mb-4">Stock value by days since last sale — total: {fmtAna(totalValue)}</p>
            <div className="space-y-2">
              {tierData.map((t, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32">{t.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width: `${maxValue > 0 ? t.value / maxValue * 100 : 0}%`, background: t.color}} />
                  </div>
                  <span className="text-xs text-gray-500 w-8">{t.count} SKU</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: t.color}}>{fmtAna(t.value)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
