/**
 * DemandForecastPanel.tsx — AI Demand Forecast & Cash-Flow Projection
 *
 * Reads the last 90 days of orders + current inventory from Firestore,
 * sends a compact digest to Gemini, and renders demand trends,
 * a 3-month cash-flow bar chart (recharts), reorder alerts, and
 * actionable recommendations.
 */

import React, { useState } from 'react';
import {
  TrendingUp, RefreshCw, AlertCircle, Package,
  DollarSign, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TopProduct {
  name: string;
  units: number;
  trend: 'up' | 'down' | 'stable';
}

interface CashFlowMonth {
  month: string;       // "YYYY-MM"
  projected: number;
}

interface ReorderAlert {
  product: string;
  currentStock: number;
  recommendedReorder: number;
}

interface ForecastData {
  summary: string;
  topProducts: TopProduct[];
  cashFlow: CashFlowMonth[];
  recommendations: string[];
  reorderAlerts: ReorderAlert[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function trendBadge(trend: 'up' | 'down' | 'stable') {
  const cfg = {
    up:     { cls: 'bg-emerald-100 text-emerald-700', label: '↑' },
    down:   { cls: 'bg-red-100 text-red-600',         label: '↓' },
    stable: { cls: 'bg-gray-100 text-gray-500',       label: '→' },
  }[trend];
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface DemandForecastPanelProps {
  currentLanguage?: string;
}

export default function DemandForecastPanel({ currentLanguage = 'tr' }: DemandForecastPanelProps) {
  const tr = currentLanguage === 'tr';
  const [loading,  setLoading]  = useState(false);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [showRaw,  setShowRaw]  = useState(false);

  const generate = async () => {
    setLoading(true); setError(null); setForecast(null);

    try {
      // ── 1. Fetch last 90 days of orders ─────────────────────────────────
      const since90 = Timestamp.fromDate(new Date(Date.now() - 90 * 86_400_000));
      const ordersQ  = query(collection(db, 'orders'), where('syncedAt', '>=', since90));
      const [ordersSnap, invSnap] = await Promise.all([
        getDocs(ordersQ),
        getDocs(collection(db, 'inventory')),
      ]);

      type RawOrder = {
        id: string; customerName: string; totalPrice: number; status: string;
        lineItems?: { title?: string; name?: string; sku?: string; quantity: number; price: number }[];
        syncedAt?: { toDate?: () => Date };
      };
      type RawInv = { id: string; name: string; sku?: string; quantity?: number };

      const orders   = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() } as RawOrder));
      const inventory = invSnap.docs.map(d => ({ id: d.id, ...d.data() } as RawInv));

      if (orders.length === 0) {
        setError(tr ? 'Son 90 günde sipariş bulunamadı. Önce bazı siparişler oluşturun.' : 'No orders found in the last 90 days.');
        return;
      }

      // ── 2. Aggregate product demand & monthly revenue ────────────────────
      const productMap: Record<string, { units: number; revenue: number; byMonth: Record<string, number> }> = {};
      const monthlyRevenue: Record<string, number> = {};

      for (const o of orders) {
        const d   = o.syncedAt?.toDate?.() ?? new Date();
        const mon = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyRevenue[mon] = (monthlyRevenue[mon] ?? 0) + (o.totalPrice || 0);

        for (const item of o.lineItems ?? []) {
          const name = item.title ?? item.name ?? item.sku ?? 'Unknown';
          productMap[name] ??= { units: 0, revenue: 0, byMonth: {} };
          productMap[name].units   += item.quantity;
          productMap[name].revenue += item.quantity * item.price;
          productMap[name].byMonth[mon] = (productMap[name].byMonth[mon] ?? 0) + item.quantity;
        }
      }

      const topProducts = Object.entries(productMap)
        .sort((a, b) => b[1].units - a[1].units)
        .slice(0, 8)
        .map(([name, d]) => ({
          name,
          units: d.units,
          months: Object.entries(d.byMonth).sort().map(([m, u]) => `${m}:${u}`).join('|'),
        }));

      const monthlyArr = Object.entries(monthlyRevenue).sort()
        .map(([m, r]) => `${m}: ₺${Math.round(r).toLocaleString('tr-TR')}`);

      const inventoryCtx = inventory.slice(0, 20)
        .map(i => `${i.name} (${i.quantity ?? '?'} units)`)
        .join('; ');

      // ── 3. Call Gemini ────────────────────────────────────────────────────
      const apiKey = process.env.GEMINI_API_KEY || '';
      if (!apiKey) throw new Error(tr ? 'GEMINI_API_KEY ortam değişkeni tanımlı değil.' : 'GEMINI_API_KEY env var not set.');

      const ai    = new GoogleGenAI({ apiKey });
      const lang  = tr ? 'Turkish' : 'English';
      const today = new Date().toISOString().slice(0, 7);

      const prompt = `You are a senior B2B sales analyst for Cetpa, a Turkish wholesale distributor.

Context (today: ${today}):
- Orders last 90 days: ${orders.length}
- Monthly revenue: ${monthlyArr.join(', ')}
- Top products: ${topProducts.map(p => `${p.name}: ${p.units} units [${p.months}]`).join('; ')}
- Inventory: ${inventoryCtx || 'N/A'}

Based on these trends, respond in ${lang} as valid JSON (no markdown fences):
{
  "summary": "2-3 sentence executive summary",
  "topProducts": [{"name":"...","units":number,"trend":"up"|"down"|"stable"}],
  "cashFlow": [{"month":"YYYY-MM","projected":number}],
  "recommendations": ["string","string","string"],
  "reorderAlerts": [{"product":"...","currentStock":number,"recommendedReorder":number}]
}
Rules: topProducts ≤ 5; cashFlow = next 3 months projection; reorderAlerts only for products where stock < 30-day demand. All monetary values in TRY integers.`;

      const res = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary:       { type: Type.STRING },
              topProducts:   { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, units: { type: Type.NUMBER }, trend: { type: Type.STRING } }, required: ['name','units','trend'] } },
              cashFlow:      { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { month: { type: Type.STRING }, projected: { type: Type.NUMBER } }, required: ['month','projected'] } },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              reorderAlerts: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { product: { type: Type.STRING }, currentStock: { type: Type.NUMBER }, recommendedReorder: { type: Type.NUMBER } }, required: ['product','currentStock','recommendedReorder'] } },
            },
            required: ['summary','topProducts','cashFlow','recommendations','reorderAlerts'],
          },
        },
      });

      const data = JSON.parse(res.text) as ForecastData;
      setForecast(data);

    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-gray-900">
              {tr ? 'AI Talep Tahmini & Nakit Akışı' : 'AI Demand Forecast & Cash Flow'}
            </h3>
            <p className="text-[11px] text-gray-400">
              {tr ? 'Gemini · son 90 gün sipariş verisi' : 'Gemini · last 90 days of order data'}
            </p>
          </div>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading
            ? (tr ? 'Analiz ediliyor…' : 'Analysing…')
            : (tr ? 'Tahmin Oluştur' : 'Generate Forecast')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl p-3 bg-red-50 text-red-600 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Loading pulse */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          {[80, 56, 72].map((h, i) => (
            <div key={i} className={`h-${h === 80 ? '20' : h === 56 ? '14' : '16'} bg-gray-100 rounded-xl`} style={{ height: h }} />
          ))}
        </div>
      )}

      {/* Results */}
      {forecast && !loading && (
        <div className="space-y-4">

          {/* Executive summary */}
          <div className="rounded-xl bg-violet-50 border border-violet-100 p-4">
            <p className="text-sm text-violet-900 leading-relaxed">{forecast.summary}</p>
          </div>

          {/* Top products */}
          {forecast.topProducts?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
              <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" />
                {tr ? 'Öne Çıkan Ürünler' : 'Top Products'}
              </h4>
              <div className="space-y-2">
                {forecast.topProducts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-700 font-medium truncate">{p.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400 tabular-nums">
                        {p.units.toLocaleString('tr-TR')} {tr ? 'adet' : 'units'}
                      </span>
                      {trendBadge(p.trend)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cash flow bar chart */}
          {forecast.cashFlow?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
              <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5" />
                {tr ? '3 Aylık Nakit Akışı Tahmini' : '3-Month Cash Flow Projection'}
              </h4>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={forecast.cashFlow} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={v => `₺${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    axisLine={false} tickLine={false} width={48}
                  />
                  <Tooltip
                    formatter={(v: number) => [`₺${v.toLocaleString('tr-TR')}`, tr ? 'Tahmini' : 'Projected']}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 11 }}
                  />
                  <Bar dataKey="projected" radius={[6, 6, 0, 0]}>
                    {forecast.cashFlow.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#7c3aed' : i === 1 ? '#8b5cf6' : '#a78bfa'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Reorder alerts */}
          {forecast.reorderAlerts?.length > 0 && (
            <div className="bg-white rounded-xl border border-amber-100 p-4 space-y-3">
              <h4 className="text-xs font-bold text-amber-600 uppercase flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                {tr ? 'Yeniden Sipariş Uyarıları' : 'Reorder Alerts'}
              </h4>
              <div className="space-y-2">
                {forecast.reorderAlerts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-gray-700 font-medium truncate">{a.product}</span>
                    <div className="flex items-center gap-3 flex-shrink-0 text-[11px]">
                      <span className="text-gray-400">
                        {tr ? 'Stok' : 'Stock'}:&nbsp;<b className="text-red-600">{a.currentStock}</b>
                      </span>
                      <span className="text-gray-400">
                        {tr ? 'Sipariş Et' : 'Reorder'}:&nbsp;<b className="text-emerald-600">{a.recommendedReorder}</b>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {forecast.recommendations?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase">
                {tr ? 'AI Önerileri' : 'AI Recommendations'}
              </h4>
              <ul className="space-y-1.5">
                {forecast.recommendations.map((r, i) => (
                  <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                    <span className="text-violet-400 font-bold mt-0.5 flex-shrink-0">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Raw JSON debug toggle */}
          <button
            onClick={() => setShowRaw(v => !v)}
            className="w-full flex items-center justify-center gap-1 text-[10px] text-gray-300 hover:text-gray-400 transition-colors py-1"
          >
            {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showRaw ? (tr ? 'Ham veriyi gizle' : 'Hide raw') : (tr ? 'Ham JSON' : 'Raw JSON')}
          </button>
          {showRaw && (
            <pre className="text-[10px] bg-gray-50 rounded-xl p-3 overflow-auto text-gray-500 max-h-48">
              {JSON.stringify(forecast, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Empty state */}
      {!forecast && !loading && !error && (
        <div className="text-center py-10 border-2 border-dashed border-gray-100 rounded-xl">
          <TrendingUp className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400 font-medium">
            {tr ? '"Tahmin Oluştur" butonuna basın' : 'Press "Generate Forecast" to start'}
          </p>
          <p className="text-[11px] text-gray-300 mt-1">
            {tr
              ? 'Son 90 gün sipariş verisi Gemini ile analiz edilir.'
              : 'Last 90 days of order data is analysed with Gemini.'}
          </p>
        </div>
      )}
    </div>
  );
}
