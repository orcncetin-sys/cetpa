/**
 * useReportsData.ts — ReportsDashboard'ın paylaşılan hesaplama katmanı.
 *
 * 16.101 satırlık ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya kod
 * tabanının en büyüğüydü; altı sekmenin 332 render bloğu dosya boyunca iç içe
 * dağılmıştı ama hepsi bu tek kapsamı kullanıyordu.
 *
 * Tüm state/memo/effect burada; sekme bileşenleri sonucu tek `ctx` nesnesi
 * olarak alır. ReportsCtx tipi ReturnType ile OTOMATİK türetilir — 47 alanı
 * elle yazıp senkron tutma yükü yok.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { pdfBaslik, pdfAltBilgi, pdfTabloStili } from '../../utils/pdfTheme';
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
import { registerTurkishFont } from '../../utils/pdfFont';
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

// ── Module-level helpers ───────────────────────────────────────────────────────

function itemCostTRY(item: InventoryItem, rates: Record<string, number> | null | undefined): number {
  const raw = item.costPrice ?? (item as unknown as { cost?: number }).cost ?? 0;
  const cur = (item as unknown as { costCurrency?: string }).costCurrency;
  if (!cur || cur === 'TRY' || !rates) return raw;
  return raw * (rates[cur] ?? 1);
}

function itemPriceTRY(item: InventoryItem, tier: string, rates: Record<string, number> | null | undefined): number {
  const raw = (item.prices?.[tier] as number | undefined) ?? (item as unknown as { price?: number }).price ?? 0;
  const cur = (item as unknown as { priceCurrency?: string }).priceCurrency;
  if (!cur || cur === 'TRY' || !rates) return raw;
  return raw * (rates[cur] ?? 1);
}

export type ReportsProps = {orders: Order[], inventory: InventoryItem[], exchangeRates: Record<string, number> | null, currentT: Record<string, string>, currentLanguage: string, userRole?: string | null, onNavigate?: (tab: string) => void, employees: Employee[], quotations?: Quotation[], inventoryMovements?: InventoryMovement[], recurringOrders?: Array<{ id: string; templateName: string; customerName: string; totalPrice: number; frequency: 'weekly' | 'monthly' | 'quarterly'; nextDue: string; active: boolean }>, externalTab?: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler', setExternalTab?: (t: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler') => void};

export function useReportsData({ orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations = [], inventoryMovements = [], recurringOrders = [], externalTab, setExternalTab }: ReportsProps) {
  const [timeRange, setTimeRange] = useState('30');
  const [revenueCurrency, setRevenueCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [_localReportsTab, _setLocalReportsTab] = useState<'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler'>('genel');
  const reportsTab = externalTab ?? _localReportsTab;
  const setReportsTab = (t: 'genel'|'crm'|'envanter'|'lojistik'|'ik'|'urunler') => { _setLocalReportsTab(t); setExternalTab?.(t); };
  const [invSummarySort, setInvSummarySort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'name', dir: 'asc'});
  const [logisticsSummarySort, setLogisticsSummarySort] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'customerName', dir: 'asc'});
  // fmtAna uses revenueCurrency (same as the per-card toggle — no separate global state needed)
  const fmtAna = (v: number, fmt: 'full' | 'K' = 'full', decimals = 0): string => {
    const usd = exchangeRates?.USD ?? 38; // FX fallback (App.tsx FX_FALLBACK ile hizalı)
    const eur = exchangeRates?.EUR ?? 41;
    const rate = revenueCurrency === 'USD' ? usd : revenueCurrency === 'EUR' ? eur : 1;
    const sym = revenueCurrency === 'USD' ? '$' : revenueCurrency === 'EUR' ? '€' : '₺';
    const locale = revenueCurrency === 'USD' ? 'en-US' : revenueCurrency === 'EUR' ? 'de-DE' : 'tr-TR';
    const cv = v / rate;
    if (fmt === 'K') return `${sym}${(cv/1000).toFixed(decimals)}K`;
    return `${sym}${cv.toLocaleString(locale, {maximumFractionDigits: decimals})}`;
  };

  // HR Data for Reports
  const [hrStats, setHrStats] = useState({
    activeEmployees: 0,
    totalPayroll: 0,
    pendingLeave: 0,
    departmentDistribution: [] as { name: string, value: number }[],
    payrollTrend: [] as { name: string, value: number }[]
  });

  useEffect(() => {
    if (!employees) return;
    const active = employees.filter(e => e.status === 'Aktif').length;
    const depts = employees.reduce((acc: Record<string, number>, e) => {
      acc[e.department] = (acc[e.department] || 0) + 1;
      return acc;
    }, {});
     
    setHrStats(prev => ({
      ...prev,
      activeEmployees: active,
      departmentDistribution: Object.entries(depts).map(([name, value]) => ({ name, value: Number(value) }))
    }));
  }, [employees]);

  useEffect(() => {
    if (reportsTab !== 'ik' || !userRole) return;

    const unsubLeave = onSnapshot(query(collection(db, 'leaveRequests'), where('status', '==', 'Bekliyor')), (snap) => {
      setHrStats(prev => ({ ...prev, pendingLeave: snap.size }));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'leaveRequests', auth.currentUser?.uid));

    const unsubPayroll = onSnapshot(collection(db, 'payrolls'), (snap) => {
      const pays = sortByCreatedAt(snap.docs.map(d => d.data()));
      const total = pays.filter(p => p.status === 'Ödendi').reduce((sum, p) => sum + (p.netSalary || 0), 0);
      
      const trend = pays.reduce((acc: Record<string, number>, p) => {
        const key = `${p.month}/${p.year}`;
        acc[key] = (acc[key] || 0) + (p.netSalary || 0);
        return acc;
      }, {});

      setHrStats(prev => ({
        ...prev,
        totalPayroll: total,
        payrollTrend: Object.entries(trend).map(([name, value]) => ({ name, value: Number(value) }))
      }));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'payrolls', auth.currentUser?.uid));

    return () => {
      unsubLeave();
      unsubPayroll();
    };
  }, [reportsTab, userRole]);

  // KPI Calculations
  const totalRevenueTRY = useMemo(() => orders
    .filter(o => o.status !== 'Cancelled')
    .reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0), [orders]);
  const revenueSymbol = revenueCurrency === 'USD' ? '$' : revenueCurrency === 'EUR' ? '€' : '₺';
  const revenueFormatted = formatInCurrency(totalRevenueTRY, revenueCurrency, exchangeRates);
  const totalOrders = orders.length;
  const avgOrderValueTRY = totalOrders > 0 ? totalRevenueTRY / totalOrders : 0;
  const avgOrderFormatted = formatInCurrency(avgOrderValueTRY, revenueCurrency, exchangeRates);
  const lowStockItems = inventory.filter(i => i.stockLevel <= i.lowStockThreshold).length;

  // Sales Trend Data
  const salesByDate = useMemo(() => orders.reduce((acc: Record<string, { label: string; total: number }>, o) => {
    let dateKey = 'unknown';
    let label = currentT.unknown;
    if (o.syncedAt) {
      try {
        const d = typeof (o.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (o.syncedAt as { toDate: () => Date }).toDate() : new Date(o.syncedAt as unknown as string | number | Date);
        dateKey = format(d, 'yyyy-MM-dd');
        label = format(d, 'dd MMM', { locale: currentLanguage === 'tr' ? tr : enUS });
      } catch (e) {
        console.error("Error formatting date:", e);
      }
    }
    if (!acc[dateKey]) acc[dateKey] = { label, total: 0 };
    acc[dateKey].total += (Number(o.totalPrice) || 0);
    return acc;
  }, {}), [orders, currentT, currentLanguage]);

  const trendData = useMemo(() => Object.entries(salesByDate)
    .sort(([keyA], [keyB]) => {
      if (keyA === 'unknown') return 1;
      if (keyB === 'unknown') return -1;
      return keyA.localeCompare(keyB);
    })
    .map(([, val]) => ({ name: val.label, value: val.total }))
    .slice(-30), [salesByDate]);

  // Category Data
  const categoryData = useMemo(() => inventory.reduce((acc: Record<string, number>, item) => {
    const category = item.category || currentT.other;
    acc[category] = (acc[category] || 0) + item.stockLevel;
    return acc;
  }, {}), [inventory, currentT]);
  const categoryChartData = useMemo(() => Object.entries(categoryData).map(([name, value]) => ({ name, value: Number(value) })), [categoryData]);

  // --- CRM sub-data ---
  const ordersByStatus = useMemo(() => orders.reduce((acc: Record<string, number>, o) => { acc[o.status] = (acc[o.status]||0)+1; return acc; }, {}), [orders]);
  const statusChartData = useMemo(() => Object.entries(ordersByStatus).map(([name, value]) => ({ name, value: Number(value) })), [ordersByStatus]);
  const topCustomers = useMemo(() => Object.values(
    orders.reduce((acc: Record<string, { name: string; total: number; count: number }>, o) => {
      const k = o.customerName || '—';
      if (!acc[k]) acc[k] = { name: k, total: 0, count: 0 };
      acc[k].total += Number(o.totalPrice) || 0;
      acc[k].count += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total).slice(0, 8), [orders]);

  // --- Inventory sub-data ---
  const totalInventoryValueTRY = useMemo(() => inventory.reduce((s, i) => s + (i.stockLevel * ((i.prices?.['Retail']) || 0)), 0), [inventory]);
  const categoryValueData = useMemo(() => inventory.reduce((acc: Record<string, { name: string; count: number; value: number }>, item) => {
    const cat = item.category || 'Diğer';
    if (!acc[cat]) acc[cat] = { name: cat, count: 0, value: 0 };
    acc[cat].count += item.stockLevel;
    acc[cat].value += item.stockLevel * ((item.prices?.['Retail']) || 0);
    return acc;
  }, {}), [inventory]);
  const categoryValueChartData = useMemo(() => Object.values(categoryValueData), [categoryValueData]);

  const COLORS = ['#ff4000', '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#00C7BE', '#FF2D55'];

  const exportPDF = async () => {
    const doc = new jsPDF();
    await registerTurkishFont(doc);
    // Marka basligi + tablo stili ORTAK temadan (src/utils/pdfTheme.ts).
    // Bu belge 2026-08-22'ye kadar duz metin baslik ve autoTable'in VARSAYILAN
    // MAVI tablo basligiyla cikiyordu — teklif/siparis kirmizi kurumsal
    // kimlikteyken bu rapor bambaska gorunuyordu.
    const govdeY = pdfBaslik(doc, {
      belgeAdi: currentT.report_title || 'SATIŞ RAPORU',
      meta: format(new Date(), 'dd.MM.yyyy'),
    });
    autoTable(doc, {
      ...pdfTabloStili(),
      head: [[currentT.customer, currentT.amount, currentT.status, currentT.date]],
      body: orders.map(o => [
        o.customerName,
        // toLocaleString() locale/ondalik verilmeden cagriliyordu: tarayici
        // yerel ayarina gore 3 ondalik basiyordu ("80.000,016 TL").
        `${(Number(o.totalPrice) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`,
        currentT[o.status.toLowerCase()] || o.status,
        o.syncedAt ? format(typeof (o.syncedAt as { toDate?: () => Date }).toDate === 'function' ? (o.syncedAt as { toDate: () => Date }).toDate() : new Date(o.syncedAt as unknown as string | number | Date), 'dd.MM.yyyy') : ''
      ]),
      startY: govdeY,
    });
    pdfAltBilgi(doc);
    doc.save(`cetpa-rapor-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
  };


  return { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, salesByDate, trendData, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF };
}

/** Sekme bileşenlerinin aldığı bağlam — hook'un dönüşünden otomatik türer. */
export type ReportsCtx = ReturnType<typeof useReportsData>;

export { itemCostTRY, itemPriceTRY };
