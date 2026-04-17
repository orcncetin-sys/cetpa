/**
 * CariEkstrePanel.tsx — Cari Ekstre + Vade Analizi (AR Aging)
 *
 * Pure Firebase query — no Mikro needed.
 * Shows: current/30/60/90/90+ day aging buckets + row-level detail
 * per customer or across all customers.
 *
 * Usage:
 *   <CariEkstrePanel currentLanguage="tr" />                   ← all customers
 *   <CariEkstrePanel currentLanguage="tr" leadId={lead.id} />  ← one customer
 */

import React, { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { FileText, AlertTriangle, CheckCircle2, Clock, TrendingUp, Download } from 'lucide-react';
import { type Order } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgingBuckets {
  current: number; // 0-30 days
  d30: number;     // 31-60
  d60: number;     // 61-90
  d90: number;     // 91-120
  over90: number;  // 120+
}

interface AgingRow {
  id: string;
  customerName: string;
  amount: number;
  ageD: number;
  status: string;
  createdAt: string | null;
  leadId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ageLabel(ageD: number): string {
  if (ageD <= 30)  return '0–30';
  if (ageD <= 60)  return '31–60';
  if (ageD <= 90)  return '61–90';
  if (ageD <= 120) return '91–120';
  return '120+';
}

function ageColor(ageD: number): string {
  if (ageD <= 30)  return 'bg-green-100 text-green-700';
  if (ageD <= 60)  return 'bg-yellow-100 text-yellow-700';
  if (ageD <= 90)  return 'bg-orange-100 text-orange-700';
  return 'bg-red-100 text-red-600';
}

function fmt(n: number): string {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string') { const d = new Date(ts); return isNaN(d.getTime()) ? null : d; }
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) return new Date((ts as { seconds: number }).seconds * 1000);
  return null;
}

// ── Bucket bar ────────────────────────────────────────────────────────────────

function BucketBar({ buckets, lang }: { buckets: AgingBuckets; lang: string }) {
  const t = lang === 'tr';
  const total = Object.values(buckets).reduce((s, v) => s + v, 0) || 1;
  const items = [
    { label: t ? '0–30 Gün' : '0–30 Days',   value: buckets.current, color: 'bg-green-400' },
    { label: t ? '31–60 Gün' : '31–60 Days',  value: buckets.d30,     color: 'bg-yellow-400' },
    { label: t ? '61–90 Gün' : '61–90 Days',  value: buckets.d60,     color: 'bg-orange-400' },
    { label: t ? '91–120 Gün' : '91–120 Days', value: buckets.d90,    color: 'bg-red-400' },
    { label: t ? '120+ Gün' : '120+ Days',    value: buckets.over90,  color: 'bg-red-700' },
  ];
  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-4 rounded-full overflow-hidden w-full gap-px">
        {items.map((b, i) => {
          const pct = (b.value / total) * 100;
          if (pct < 0.5) return null;
          return <div key={i} className={`${b.color} transition-all`} style={{ width: `${pct}%` }} title={`${b.label}: ₺${fmt(b.value)}`} />;
        })}
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-sm flex-shrink-0 ${b.color}`} />
            <div>
              <div className="text-[10px] text-gray-500">{b.label}</div>
              <div className="text-xs font-bold text-gray-800">₺{fmt(b.value)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface CariEkstrePanelProps {
  currentLanguage?: string;
  leadId?: string;       // if set: show only this customer's data
  customerName?: string; // display name for the header
}

export default function CariEkstrePanel({
  currentLanguage = 'tr',
  leadId,
  customerName,
}: CariEkstrePanelProps) {
  const t = currentLanguage === 'tr';

  const [rows, setRows]       = useState<AgingRow[]>([]);
  const [buckets, setBuckets] = useState<AgingBuckets>({ current: 0, d30: 0, d60: 0, d90: 0, over90: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<'all' | 'overdue'>('all');
  const [sortCol, setSortCol] = useState<'ageD' | 'amount' | 'customerName'>('ageD');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  // ── Live Firestore subscription ────────────────────────────────────────────
  useEffect(() => {
    const ordersRef = collection(db, 'orders');
    let q = query(
      ordersRef,
      where('status', 'in', ['Pending', 'Processing', 'Shipped']),
      orderBy('createdAt', 'desc'),
    );
    if (leadId) {
      q = query(
        ordersRef,
        where('leadId', '==', leadId),
        where('status', 'in', ['Pending', 'Processing', 'Shipped']),
        orderBy('createdAt', 'desc'),
      );
    }
    const unsub = onSnapshot(q, snap => {
      const now = Date.now();
      const newBuckets: AgingBuckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
      const newRows: AgingRow[] = [];

      snap.docs.forEach(d => {
        const o = d.data() as Order & { createdAt?: unknown; leadId?: string };
        const dt = toDate(o.createdAt);
        const ageD = dt ? Math.floor((now - dt.getTime()) / 86400000) : 0;
        const amount = Number(o.totalPrice ?? o.totalAmount ?? 0);

        if (ageD <= 30)       newBuckets.current += amount;
        else if (ageD <= 60)  newBuckets.d30     += amount;
        else if (ageD <= 90)  newBuckets.d60     += amount;
        else if (ageD <= 120) newBuckets.d90     += amount;
        else                  newBuckets.over90  += amount;

        newRows.push({
          id: d.id,
          customerName: o.customerName || '—',
          amount,
          ageD,
          status: o.status,
          createdAt: dt ? dt.toLocaleDateString('tr-TR') : null,
          leadId: o.leadId,
        });
      });

      setBuckets(newBuckets);
      setRows(newRows);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [leadId]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalAR = Object.values(buckets).reduce((s, v) => s + v, 0);
  const overdueAR = buckets.d30 + buckets.d60 + buckets.d90 + buckets.over90;

  const displayed = [...rows]
    .filter(r => filter === 'all' || r.ageD > 30)
    .sort((a, b) => {
      const va = a[sortCol]; const vb = b[sortCol];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 1 ? -1 : 1);
    else { setSortCol(col); setSortDir(-1); }
  };

  // ── CSV export ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const header = ['Müşteri', 'Tutar (TRY)', 'Vade (Gün)', 'Durum', 'Tarih'];
    const csvRows = displayed.map(r => [r.customerName, r.amount.toFixed(2), r.ageD, r.status, r.createdAt ?? ''].map(v => `"${v}"`).join(','));
    const csv = [header.join(','), ...csvRows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = 'vade-analizi.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          <h3 className="font-bold text-sm text-gray-900">
            {customerName
              ? `${customerName} — ${t ? 'Cari Ekstre' : 'Account Statement'}`
              : (t ? 'Vade Analizi (AR Aging)' : 'AR Aging Report')}
          </h3>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors">
          <Download className="w-3.5 h-3.5" />CSV
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <div className="text-[10px] text-blue-500 font-bold uppercase">{t ? 'Toplam Alacak' : 'Total AR'}</div>
          <div className="text-base font-bold text-blue-700">₺{fmt(totalAR)}</div>
        </div>
        <div className={`rounded-xl p-3 text-center ${overdueAR > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className={`text-[10px] font-bold uppercase ${overdueAR > 0 ? 'text-red-500' : 'text-green-500'}`}>{t ? 'Vadesi Geçmiş' : 'Overdue'}</div>
          <div className={`text-base font-bold ${overdueAR > 0 ? 'text-red-700' : 'text-green-700'}`}>₺{fmt(overdueAR)}</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <div className="text-[10px] text-gray-500 font-bold uppercase">{t ? 'Açık Sipariş' : 'Open Orders'}</div>
          <div className="text-base font-bold text-gray-700">{rows.length}</div>
        </div>
      </div>

      {/* Aging bar */}
      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />{t ? 'Vade Dağılımı' : 'Aging Distribution'}
          </h4>
          <BucketBar buckets={buckets} lang={currentLanguage} />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Table toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex gap-2">
            {(['all', 'overdue'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${
                  filter === f ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {f === 'all' ? (t ? 'Tümü' : 'All') : (t ? 'Vadesi Geçmiş' : 'Overdue')}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-gray-400">{displayed.length} {t ? 'kayıt' : 'records'}</span>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">{t ? 'Yükleniyor…' : 'Loading…'}</div>
        ) : displayed.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500 font-medium">{t ? 'Açık alacak yok.' : 'No open receivables.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {!leadId && (
                    <th
                      onClick={() => handleSort('customerName')}
                      className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] cursor-pointer hover:text-gray-600 select-none"
                    >
                      {t ? 'Müşteri' : 'Customer'} {sortCol === 'customerName' ? (sortDir === -1 ? '↓' : '↑') : ''}
                    </th>
                  )}
                  <th
                    onClick={() => handleSort('amount')}
                    className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] cursor-pointer hover:text-gray-600 select-none text-right"
                  >
                    {t ? 'Tutar' : 'Amount'} {sortCol === 'amount' ? (sortDir === -1 ? '↓' : '↑') : ''}
                  </th>
                  <th
                    onClick={() => handleSort('ageD')}
                    className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] cursor-pointer hover:text-gray-600 select-none text-center"
                  >
                    {t ? 'Vade (Gün)' : 'Age (Days)'} {sortCol === 'ageD' ? (sortDir === -1 ? '↓' : '↑') : ''}
                  </th>
                  <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] text-center">{t ? 'Durum' : 'Status'}</th>
                  <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px]">{t ? 'Tarih' : 'Date'}</th>
                  <th className="px-4 py-2.5 font-bold text-gray-400 uppercase text-[10px] text-center">{t ? 'Uyarı' : 'Alert'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                    {!leadId && (
                      <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[160px] truncate">{row.customerName}</td>
                    )}
                    <td className="px-4 py-2.5 text-right font-bold text-gray-800">₺{fmt(row.amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ageColor(row.ageD)}`}>
                        {ageLabel(row.ageD)} {t ? 'gün' : 'd'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{row.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{row.createdAt ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      {row.ageD > 90
                        ? <span title={t ? 'Kritik gecikme' : 'Critical overdue'}><AlertTriangle className="w-4 h-4 text-red-400 mx-auto" /></span>
                        : row.ageD > 30
                          ? <span title={t ? 'Vadesi geçmiş' : 'Overdue'}><Clock className="w-4 h-4 text-orange-400 mx-auto" /></span>
                          : <CheckCircle2 className="w-4 h-4 text-green-400 mx-auto" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
