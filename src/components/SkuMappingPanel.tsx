/**
 * SkuMappingPanel.tsx — Mikro ↔ Shopify ↔ pazaryeri stok kodu eşleştirme ekranı
 *
 * skuMappings koleksiyonu: doc id = normalize edilmiş Mikro SKU
 *   { mikroSku, productName, shopifySku?, trendyolSku?, hepsiburadaSku?,
 *     status: 'matched' | 'unmatched' | 'manual', matchType?, updatedAt }
 *
 * "Otomatik Eşleştir" → POST /api/sku-mapping/auto-match (Shopify varyant SKU'ları
 * normalize edilip indekslenir, birebir eşleşenler işaretlenir).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';
import { authFetch } from '../services/authFetch';
import { logAudit } from '../services/auditLog';
import { RefreshCw, Search, Link2, CheckCircle2, AlertTriangle, Save } from 'lucide-react';

interface SkuMapping {
  id: string;
  mikroSku: string;
  productName?: string;
  shopifySku?: string;
  trendyolSku?: string;
  hepsiburadaSku?: string;
  status?: 'matched' | 'unmatched' | 'manual';
  matchType?: string;
}

interface Props {
  currentLanguage: string;
}

const PAGE_SIZE = 50;

const SkuMappingPanel: React.FC<Props> = ({ currentLanguage }) => {
  const tr = currentLanguage === 'tr';
  const [mappings, setMappings] = useState<SkuMapping[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [page, setPage] = useState(0);
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<SkuMapping>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'skuMappings'), snap => {
      setMappings(snap.docs.map(d => ({ id: d.id, ...d.data() } as SkuMapping)));
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return mappings
      .filter(m => {
        if (filter === 'matched' && m.status === 'unmatched') return false;
        if (filter === 'unmatched' && m.status !== 'unmatched') return false;
        if (!q) return true;
        return (m.mikroSku || '').toLowerCase().includes(q) ||
               (m.productName || '').toLowerCase().includes(q) ||
               (m.shopifySku || '').toLowerCase().includes(q);
      })
      .sort((a, b) => (a.mikroSku || '').localeCompare(b.mikroSku || '', 'tr'));
  }, [mappings, search, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  useEffect(() => { setPage(0); }, [search, filter]);

  const matchedCount = mappings.filter(m => m.status !== 'unmatched').length;
  const unmatchedCount = mappings.length - matchedCount;

  const runAutoMatch = async () => {
    setMatching(true);
    setMatchResult(null);
    try {
      const r = await authFetch('/api/sku-mapping/auto-match', { method: 'POST' });
      const d = await r.json();
      if (d.success) {
        setMatchResult(tr
          ? `✓ ${d.matched} eşleşti, ${d.unmatched} eşleşmedi (Shopify: ${d.shopifyVariants} varyant)`
          : `✓ ${d.matched} matched, ${d.unmatched} unmatched (Shopify: ${d.shopifyVariants} variants)`);
      } else {
        setMatchResult(`⚠ ${d.error || 'Hata'}`);
      }
    } catch (e) {
      setMatchResult(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMatching(false);
    }
  };

  const saveDraft = async (m: SkuMapping) => {
    const draft = drafts[m.id];
    if (!draft) return;
    setSavingId(m.id);
    try {
      const hasAny = !!(draft.shopifySku ?? m.shopifySku) || !!(draft.trendyolSku ?? m.trendyolSku) || !!(draft.hepsiburadaSku ?? m.hepsiburadaSku);
      await setDoc(doc(db, 'skuMappings', m.id), {
        ...draft,
        status: hasAny ? 'manual' : 'unmatched',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      logAudit('SKU Eşleştirme', `${m.mikroSku} manuel eşleştirildi`);
      setDrafts(prev => { const next = { ...prev }; delete next[m.id]; return next; });
    } finally {
      setSavingId(null);
    }
  };

  const setField = (id: string, field: keyof SkuMapping, value: string) =>
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  return (
    <div className="apple-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-brand" />
          <h3 className="text-sm font-bold text-gray-900">
            {tr ? 'Stok Kodu Eşleştirme' : 'SKU Mapping'}
          </h3>
          <span className="text-[11px] text-gray-400">
            {tr ? 'Mikro ↔ Shopify ↔ Pazaryerleri' : 'Mikro ↔ Shopify ↔ Marketplaces'}
          </span>
        </div>
        <button
          onClick={runAutoMatch}
          disabled={matching}
          className="apple-button-primary text-xs px-4 py-2 flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${matching ? 'animate-spin' : ''}`} />
          {matching ? (tr ? 'Eşleştiriliyor…' : 'Matching…') : (tr ? 'Otomatik Eşleştir' : 'Auto-Match')}
        </button>
      </div>

      {matchResult && (
        <div className={`text-xs rounded-xl px-3 py-2 ${matchResult.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {matchResult}
        </div>
      )}

      {/* Stats + filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          ['all', tr ? `Tümü (${mappings.length})` : `All (${mappings.length})`],
          ['matched', `✓ ${tr ? 'Eşleşen' : 'Matched'} (${matchedCount})`],
          ['unmatched', `⚠ ${tr ? 'Eşleşmeyen' : 'Unmatched'} (${unmatchedCount})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors ${filter === key ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >
            {label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tr ? 'SKU veya ürün ara…' : 'Search SKU or product…'}
            className="apple-input pl-9 py-1.5 text-xs w-56"
          />
        </div>
      </div>

      {/* Table */}
      {mappings.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          {tr
            ? 'Henüz eşleştirme yok. Önce Mikro\'dan stokları içeri alın, sonra "Otomatik Eşleştir"e basın.'
            : 'No mappings yet. Import Mikro stock first, then click "Auto-Match".'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="py-2 px-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Mikro SKU</th>
                <th className="py-2 px-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden lg:table-cell">{tr ? 'Ürün' : 'Product'}</th>
                <th className="py-2 px-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Shopify</th>
                <th className="py-2 px-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">Trendyol</th>
                <th className="py-2 px-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider hidden md:table-cell">Hepsiburada</th>
                <th className="py-2 px-3 text-[10px] font-bold text-[#86868B] uppercase tracking-wider text-center">{tr ? 'Durum' : 'Status'}</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paged.map(m => {
                const draft = drafts[m.id] ?? {};
                const dirty = Object.keys(draft).length > 0;
                return (
                  <tr key={m.id} className="hover:bg-gray-50/50">
                    <td className="py-2 px-3 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{m.mikroSku}</td>
                    <td className="py-2 px-3 text-xs text-gray-500 hidden lg:table-cell max-w-[220px] truncate">{m.productName || '—'}</td>
                    <td className="py-2 px-3">
                      <input
                        value={(draft.shopifySku ?? m.shopifySku) || ''}
                        onChange={e => setField(m.id, 'shopifySku', e.target.value)}
                        placeholder="—"
                        className="bg-gray-50 border border-transparent focus:border-brand/30 rounded-lg px-2 py-1 text-xs font-mono w-32 outline-none"
                      />
                    </td>
                    <td className="py-2 px-3 hidden md:table-cell">
                      <input
                        value={(draft.trendyolSku ?? m.trendyolSku) || ''}
                        onChange={e => setField(m.id, 'trendyolSku', e.target.value)}
                        placeholder="—"
                        className="bg-gray-50 border border-transparent focus:border-brand/30 rounded-lg px-2 py-1 text-xs font-mono w-28 outline-none"
                      />
                    </td>
                    <td className="py-2 px-3 hidden md:table-cell">
                      <input
                        value={(draft.hepsiburadaSku ?? m.hepsiburadaSku) || ''}
                        onChange={e => setField(m.id, 'hepsiburadaSku', e.target.value)}
                        placeholder="—"
                        className="bg-gray-50 border border-transparent focus:border-brand/30 rounded-lg px-2 py-1 text-xs font-mono w-28 outline-none"
                      />
                    </td>
                    <td className="py-2 px-3 text-center">
                      {m.status === 'unmatched' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">
                          <AlertTriangle className="w-3 h-3" /> {tr ? 'Eşleşmedi' : 'Unmatched'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">
                          <CheckCircle2 className="w-3 h-3" /> {m.status === 'manual' ? (tr ? 'Manuel' : 'Manual') : (tr ? 'Otomatik' : 'Auto')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {dirty && (
                        <button
                          onClick={() => saveDraft(m)}
                          disabled={savingId === m.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-brand rounded-full px-3 py-1 disabled:opacity-60"
                        >
                          <Save className="w-3 h-3" />
                          {savingId === m.id ? '…' : (tr ? 'Kaydet' : 'Save')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#86868B]">{filtered.length} {tr ? 'kayıt' : 'records'} · {safePage + 1}/{pageCount}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0} className="apple-button-secondary px-4 py-1.5 text-xs font-semibold disabled:opacity-40">←</button>
            <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1} className="apple-button-secondary px-4 py-1.5 text-xs font-semibold disabled:opacity-40">→</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SkuMappingPanel;
