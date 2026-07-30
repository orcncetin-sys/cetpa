/**
 * UrunlerRapor.tsx — Raporlar > Ürün Performansı sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'urunler' sekmesine ait 1 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'urunler'` koşulları BİLEREK korundu: ebeveyn zaten
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

export default function UrunlerRapor(ctx: ReportsCtx) {
  const { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, salesByDate, trendData, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF } = ctx;
  void itemCostTRY; void itemPriceTRY; // sekmeye göre kullanılıyor olabilir
  return (
    <>
      {reportsTab === 'urunler' && (() => {
        // Build product revenue map from order lineItems
        type ProdStat = { name: string; sku: string; quantity: number; revenue: number; orderCount: number; avgOrderValue: number };
        const prodMap: Record<string, ProdStat> = {};
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          for (const li of (o.lineItems ?? [])) {
            const liR = li as unknown as Record<string, unknown>;
            const name = (liR.name as string | undefined) ?? (liR.productName as string | undefined) ?? (liR.title as string | undefined) ?? 'Unknown';
            const sku  = (liR.sku as string | undefined) ?? '';
            const qty  = Number(liR.quantity ?? 1) || 1;
            const up   = Number(liR.unitPrice ?? liR.price ?? liR.variant_price ?? 0) || 0;
            const rev  = qty * up;
            const key  = sku || name;
            if (!prodMap[key]) prodMap[key] = { name, sku, quantity: 0, revenue: 0, orderCount: 0, avgOrderValue: 0 };
            prodMap[key].quantity  += qty;
            prodMap[key].revenue   += rev;
            prodMap[key].orderCount++;
          }
        }
        const products = Object.values(prodMap)
          .map(p => ({ ...p, avgOrderValue: p.orderCount > 0 ? p.revenue / p.orderCount : 0 }))
          .sort((a, b) => b.revenue - a.revenue);
        const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);

        // ABC classification
        let cumPct = 0;
        const classified = products.map(p => {
          const pct = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;
          cumPct += pct;
          const cls: 'A' | 'B' | 'C' = cumPct <= 70 ? 'A' : cumPct <= 90 ? 'B' : 'C';
          return { ...p, pct, cls };
        });

        const countA = classified.filter(p => p.cls === 'A').length;
        const countB = classified.filter(p => p.cls === 'B').length;
        const countC = classified.filter(p => p.cls === 'C').length;

        if (products.length === 0) return (
          <div className="apple-card p-12 text-center space-y-3">
            <Package className="w-12 h-12 text-gray-200 mx-auto" />
            <p className="text-gray-400 text-sm">
              {currentLanguage === 'tr' ? 'Sipariş satır kalemlerinde ürün verisi yok' : 'No product data found in order line items'}
            </p>
          </div>
        );

        return (
          <div className="space-y-4">
            {/* KPI Strip */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: currentLanguage === 'tr' ? 'A Sınıfı Ürün' : 'Class A Items', value: countA, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', desc: currentLanguage === 'tr' ? 'Gelirin %70\'i' : '70% of revenue' },
                { label: currentLanguage === 'tr' ? 'B Sınıfı Ürün' : 'Class B Items', value: countB, cls: 'bg-amber-50 text-amber-700 border-amber-200', desc: currentLanguage === 'tr' ? 'Gelirin %20\'si' : '20% of revenue' },
                { label: currentLanguage === 'tr' ? 'C Sınıfı Ürün' : 'Class C Items', value: countC, cls: 'bg-gray-50 text-gray-600 border-gray-200', desc: currentLanguage === 'tr' ? 'Gelirin %10\'u' : '10% of revenue' },
              ].map(k => (
                <div key={k.label} className={`rounded-xl border px-4 py-3 ${k.cls}`}>
                  <p className="text-2xl font-black">{k.value}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wide mt-0.5">{k.label}</p>
                  <p className="text-[10px] opacity-70">{k.desc}</p>
                </div>
              ))}
            </div>

            {/* Product table */}
            <div className="apple-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand" />
                <h3 className="font-bold text-gray-800 text-sm">
                  {currentLanguage === 'tr' ? 'Ürün Bazında Satış Performansı' : 'Product Revenue Performance'}
                </h3>
                <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full ml-auto">{products.length} {currentLanguage === 'tr' ? 'ürün' : 'products'}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-8">#</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {currentLanguage === 'tr' ? 'Ürün' : 'Product'}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">ABC</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {currentLanguage === 'tr' ? 'Adet' : 'Qty'}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {currentLanguage === 'tr' ? 'Sipariş' : 'Orders'}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {currentLanguage === 'tr' ? 'Gelir' : 'Revenue'}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {currentLanguage === 'tr' ? 'Pay' : 'Share'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {classified.map((p, i) => {
                      const barW = totalRevenue > 0 ? (p.revenue / classified[0].revenue) * 100 : 0;
                      return (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-[10px] font-bold text-gray-400">{i + 1}</td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-semibold text-gray-800 text-xs truncate max-w-[200px]">{p.name}</p>
                              {p.sku && <p className="text-[10px] text-gray-400 font-mono">{p.sku}</p>}
                              <div className="w-full bg-gray-100 rounded-full h-1 mt-1.5 overflow-hidden">
                                <div className="h-full rounded-full bg-brand/60" style={{ width: `${barW}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${p.cls === 'A' ? 'bg-emerald-100 text-emerald-700' : p.cls === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                              {p.cls}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-semibold text-gray-700">{p.quantity.toLocaleString('tr-TR')}</td>
                          <td className="px-4 py-3 text-right text-xs text-gray-500">{p.orderCount}</td>
                          <td className="px-4 py-3 text-right text-xs font-bold text-gray-800">₺{p.revenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-[10px] font-bold text-gray-500">{p.pct.toFixed(1)}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">{currentLanguage === 'tr' ? 'Toplam' : 'Total'}</td>
                      <td className="px-4 py-3 text-right text-sm font-black text-gray-800">₺{totalRevenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-gray-500">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
