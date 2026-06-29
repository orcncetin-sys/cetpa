import { useState, useMemo } from 'react';
import { Search, Tag, TrendingUp, Plus, X, RefreshCw, Store, Lightbulb } from 'lucide-react';
import { authedFetch } from '../lib/dbClient';
import { suggestPricing, maxBuyPrice } from '../lib/pricingEngine';
import type { InventoryItem } from '../types';

interface Props {
  inventory: InventoryItem[];
  currentLanguage: string;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

interface MarketResult { source: string; title: string; price: number; currency: string; url?: string }

const ftl = (v: number) => `₺${Math.round(v).toLocaleString('tr-TR')}`;

/**
 * Fiyat İstihbarat Paneli — ürün seç, pazaryeri (Trendyol/Amazon) rakip fiyatlarını
 * çek (veya manuel gir), pricingEngine ile satış önerisi + maksimum toptan alış üret.
 */
export default function PriceIntelPanel({ inventory, currentLanguage, toast }: Props) {
  const tr = currentLanguage === 'tr';
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [margin, setMargin] = useState(35);
  const [competitors, setCompetitors] = useState<number[]>([]);
  const [manualPrice, setManualPrice] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MarketResult[]>([]);

  const filtered = useMemo(() => {
    if (!q.trim()) return inventory.slice(0, 8);
    const s = q.toLowerCase();
    return inventory.filter(i => (i.name || '').toLowerCase().includes(s) || (i.sku || '').toLowerCase().includes(s)).slice(0, 12);
  }, [q, inventory]);

  const cost = Number(selected?.costPrice ?? selected?.cost ?? 0) || 0;
  const currentSell = Number(selected?.prices?.['Retail'] ?? selected?.price ?? 0) || 0;

  const pick = (item: InventoryItem) => {
    setSelected(item);
    setCompetitors([]); setResults([]); setQ('');
  };

  const searchMarket = async () => {
    if (!selected) return;
    setSearching(true); setResults([]);
    try {
      const res = await authedFetch('/api/marketplace/search', {
        method: 'POST',
        body: JSON.stringify({ sku: selected.sku, barcode: (selected as { barcode?: string }).barcode, query: selected.name }),
      });
      const d = await res.json() as { configured?: boolean; results?: MarketResult[] };
      if (!d.configured) {
        toast(tr ? 'Pazaryeri entegrasyonu yapılandırılmamış — fiyatları manuel girin.' : 'Marketplace not configured — enter prices manually.', 'info');
      } else {
        setResults(d.results || []);
        const prices = (d.results || []).map(r => r.price).filter(p => p > 0);
        if (prices.length) { setCompetitors(prev => [...prev, ...prices]); toast(tr ? `${prices.length} rakip fiyat bulundu.` : `${prices.length} competitor prices found.`, 'success'); }
        else toast(tr ? 'Rakip fiyat bulunamadı.' : 'No competitor prices found.', 'info');
      }
    } catch { toast(tr ? 'Arama başarısız.' : 'Search failed.', 'error'); }
    setSearching(false);
  };

  const addManual = () => {
    const p = Number(manualPrice);
    if (p > 0) { setCompetitors(prev => [...prev, p]); setManualPrice(''); }
  };

  const result = useMemo(() => suggestPricing(cost, margin, competitors), [cost, margin, competitors]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><Tag className="w-5 h-5" /></div>
        <div>
          <h2 className="text-lg font-bold text-[#1D1D1F]">{tr ? 'Fiyat İstihbaratı' : 'Price Intelligence'}</h2>
          <p className="text-xs text-[#86868B]">{tr ? 'Pazaryeri rakip fiyatları + alış/satış fiyatlandırma önerisi' : 'Marketplace competitor prices + buy/sell pricing suggestions'}</p>
        </div>
      </div>

      {/* Ürün seçimi */}
      <div className="apple-card p-4">
        <div className="relative mb-3">
          <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} aria-label={tr ? 'Ürün ara' : 'Search product'}
            placeholder={tr ? 'Ürün adı veya SKU ara...' : 'Search product or SKU...'} className="apple-input pl-9 w-full" />
        </div>
        {(q.trim() || !selected) && (
          <div className="flex flex-wrap gap-2">
            {filtered.map(i => (
              <button key={i.id} onClick={() => pick(i)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${selected?.id === i.id ? 'bg-brand text-white border-brand' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                {i.name} <span className="opacity-60">· {i.sku}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-xs text-gray-400">{tr ? 'Ürün bulunamadı.' : 'No products.'}</p>}
          </div>
        )}
      </div>

      {selected && (
        <>
          {/* Seçili ürün + maliyet */}
          <div className="apple-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-[#1D1D1F]">{selected.name}</div>
                <div className="text-[11px] text-gray-400 font-mono">{selected.sku}</div>
              </div>
              <button onClick={searchMarket} disabled={searching} className="apple-button-primary text-sm px-4 py-2 flex items-center gap-1.5 disabled:opacity-50">
                {searching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Store className="w-3.5 h-3.5" />}
                {tr ? 'Pazaryeri Ara' : 'Search Marketplace'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="bg-gray-50 rounded-xl p-3"><div className="text-[11px] text-[#86868B]">{tr ? 'Maliyet' : 'Cost'}</div><div className="text-lg font-bold text-[#1D1D1F]">{ftl(cost)}</div></div>
              <div className="bg-gray-50 rounded-xl p-3"><div className="text-[11px] text-[#86868B]">{tr ? 'Mevcut Satış (Retail)' : 'Current Sell'}</div><div className="text-lg font-bold text-[#1D1D1F]">{ftl(currentSell)} {currentSell > 0 && <span className="text-xs text-gray-400">(%{Math.round(((currentSell - cost) / currentSell) * 100)})</span>}</div></div>
            </div>
          </div>

          {/* Rakip fiyatlar */}
          <div className="apple-card p-4">
            <h4 className="text-xs font-bold text-[#86868B] uppercase mb-3">{tr ? 'Rakip Fiyatlar' : 'Competitor Prices'} ({competitors.length})</h4>
            {results.length > 0 && (
              <div className="space-y-1 mb-3">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-600"><span className="text-[10px] font-semibold bg-gray-100 px-1.5 py-0.5 rounded mr-2">{r.source}</span>{r.title.slice(0, 40)}</span>
                    <span className="font-medium">{ftl(r.price)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-3">
              {competitors.map((p, i) => (
                <span key={i} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-lg flex items-center gap-1">
                  {ftl(p)}
                  <button onClick={() => setCompetitors(prev => prev.filter((_, j) => j !== i))}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="number" value={manualPrice} onChange={e => setManualPrice(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManual()}
                aria-label={tr ? 'Manuel rakip fiyat' : 'Manual competitor price'}
                placeholder={tr ? 'Manuel rakip fiyat ekle...' : 'Add competitor price...'} className="apple-input flex-1 text-sm" />
              <button onClick={addManual} className="apple-button-secondary px-3 py-2 text-sm flex items-center gap-1"><Plus className="w-3.5 h-3.5" />{tr ? 'Ekle' : 'Add'}</button>
            </div>
          </div>

          {/* Hedef marj + öneriler */}
          <div className="apple-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-[#86868B] uppercase flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5" />{tr ? 'Fiyatlandırma Önerisi' : 'Pricing Suggestion'}</h4>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[#86868B] text-xs">{tr ? 'Hedef marj' : 'Target margin'}</span>
                <input type="range" min={0} max={80} value={margin} onChange={e => setMargin(Number(e.target.value))} className="accent-[#ff4000]" />
                <span className="font-bold text-brand w-10">%{margin}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {result.suggestions.map((s, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-[#1D1D1F]">{s.label}</div>
                    <div className={`text-[11px] ${s.note.includes('⚠️') ? 'text-red-500' : 'text-gray-400'}`}>{s.note}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-brand">{ftl(s.price)}</div>
                    <div className={`text-[10px] ${s.marginPct < 0 ? 'text-red-500' : 'text-green-600'}`}>{tr ? 'marj' : 'margin'} %{s.marginPct.toFixed(0)}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Maksimum toptan alış */}
            {result.competitor.min != null && (
              <div className="mt-3 bg-amber-50 rounded-xl p-3 flex items-center justify-between">
                <div className="text-sm text-amber-800 flex items-center gap-1.5"><TrendingUp className="w-4 h-4" />
                  {tr ? `En düşük rakibi (${ftl(result.competitor.min)}) hedef satış kabul edersen, %${margin} marjı korumak için maks. toptan alış:` : `Max wholesale buy price to keep %${margin} margin at lowest competitor:`}
                </div>
                <div className="text-lg font-bold text-amber-700 whitespace-nowrap ml-3">{ftl(result.maxBuyForMargin ?? maxBuyPrice(result.competitor.min, margin))}</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
