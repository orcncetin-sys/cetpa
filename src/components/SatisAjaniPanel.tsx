/**
 * SatisAjaniPanel — Claude "Satış Ajanı" (commerce-agents blueprint uyarlaması,
 * 2026-09-01). Seçilen müşterinin GERÇEK alım geçmişinden yeniden-sipariş +
 * çapraz satış önerisi üretir. Fiyat/stok rakamları SUNUCUDAN katalogdan
 * eklenir; model yalnız gerekçe + miktar önerir (guardrail: ticaretAjaniRoutes.ts).
 */
import { useMemo, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { authFetch } from '../services/authFetch';
import { eslesir } from '../utils/arama';

interface Oneri {
  sku: string; urunAdi: string; oneriTipi: 'yeniden-siparis' | 'capraz-satis';
  onerilenMiktar: number; gerekce: string; guncelStok: number | null; birimFiyat: number | null;
}
interface Yanit {
  success: boolean; error?: string; notConfigured?: boolean; bos?: boolean; mesaj?: string;
  ozet?: string; oneriler?: Oneri[]; riskNotlari?: string[]; elenenOneri?: number;
}

interface Props {
  currentLanguage: string;
  aiOnayli: boolean;
  /** Cari kodu bilinen müşteriler (leads'ten türetilir). */
  musteriler: Array<{ ad: string; cariKod: string }>;
}

export default function SatisAjaniPanel({ currentLanguage, aiOnayli, musteriler }: Props) {
  const tr = currentLanguage === 'tr';
  const [ara, setAra] = useState('');
  const [secili, setSecili] = useState<{ ad: string; cariKod: string } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [sonuc, setSonuc] = useState<Yanit | null>(null);

  const adaylar = useMemo(
    () => (ara.trim() ? musteriler.filter(m => eslesir(ara, m.ad)).slice(0, 8) : []),
    [ara, musteriler],
  );

  const calistir = async (m: { ad: string; cariKod: string }) => {
    setSecili(m); setAra(''); setYukleniyor(true); setSonuc(null);
    try {
      const r = await authFetch('/api/ai/satis-ajani', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cariKod: m.cariKod }),
      });
      setSonuc(await r.json() as Yanit);
    } catch (e) {
      setSonuc({ success: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setYukleniyor(false); }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-purple-100 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-purple-100 rounded-xl"><Sparkles className="w-4 h-4 text-purple-600" /></div>
        <div>
          <h3 className="font-bold text-gray-900 text-sm">{tr ? 'AI Satış Ajanı' : 'AI Sales Agent'}</h3>
          <p className="text-[11px] text-gray-400">{tr ? 'Alım geçmişinden yeniden sipariş + çapraz satış önerisi (Claude)' : 'Reorder + cross-sell from purchase history (Claude)'}</p>
        </div>
      </div>
      {!aiOnayli ? (
        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
          {tr ? 'AI kullanım onayı gerekli — sağ alttaki AI asistanını ilk açışınızda onay verebilirsiniz.' : 'AI consent required.'}
        </p>
      ) : (
        <div className="relative">
          <input value={ara} onChange={e => setAra(e.target.value)}
            placeholder={tr ? 'Müşteri ara (Mikro carisi)…' : 'Search customer…'}
            className="apple-input w-full text-sm" />
          {adaylar.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg divide-y divide-gray-50 max-h-56 overflow-y-auto">
              {adaylar.map(m => (
                <button key={m.cariKod} onClick={() => calistir(m)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50">
                  <span className="font-medium text-gray-800">{m.ad}</span>
                  <span className="block text-[10px] font-mono text-gray-400">{m.cariKod}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {secili && <p className="text-[11px] text-gray-500">{tr ? 'Müşteri:' : 'Customer:'} <span className="font-semibold text-gray-700">{secili.ad}</span></p>}
      {yukleniyor && (
        <p className="text-xs text-gray-400 flex items-center gap-2">
          {/* 'searching': ajan gerçek satış geçmişini ve katalog havuzunu tarıyor */}
          <ThinkingOrb state="searching" size={20} />
          {tr ? 'Satış geçmişi ve katalog taranıyor…' : 'Scanning sales history…'}
        </p>
      )}
      {sonuc && !sonuc.success && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{sonuc.error || (tr ? 'Öneri üretilemedi.' : 'Failed.')}</div>
      )}
      {sonuc?.success && sonuc.bos && <p className="text-xs text-gray-500">{sonuc.mesaj}</p>}
      {sonuc?.success && sonuc.oneriler && (
        <div className="space-y-2">
          {sonuc.ozet && <p className="text-xs text-gray-600">{sonuc.ozet}</p>}
          {sonuc.oneriler.map(o => (
            <div key={o.sku} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 text-xs truncate">{o.urunAdi}</p>
                  <p className="text-[10px] font-mono text-gray-400">{o.sku}</p>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${o.oneriTipi === 'yeniden-siparis' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {o.oneriTipi === 'yeniden-siparis' ? (tr ? 'Yeniden Sipariş' : 'Reorder') : (tr ? 'Çapraz Satış' : 'Cross-sell')}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">{o.gerekce}</p>
              <p className="text-[10px] text-gray-400 mt-1">
                {tr ? 'Öneri:' : 'Qty:'} <span className="font-bold text-gray-700">{o.onerilenMiktar}</span>
                {' · '}{tr ? 'Stok:' : 'Stock:'} {o.guncelStok ?? '—'}
                {' · '}{tr ? 'Birim:' : 'Unit:'} {o.birimFiyat != null ? `₺${o.birimFiyat.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '—'}
              </p>
            </div>
          ))}
          {!!sonuc.riskNotlari?.length && sonuc.riskNotlari.map((n, i) => (
            <p key={i} className="text-[11px] text-amber-800 bg-amber-50 rounded-xl px-3 py-2 flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{n}</p>
          ))}
          {typeof sonuc.elenenOneri === 'number' && sonuc.elenenOneri > 0 && (
            <p className="text-[10px] text-gray-400">{tr ? `${sonuc.elenenOneri} öneri katalog doğrulamasından geçemediği için elendi.` : `${sonuc.elenenOneri} filtered by catalog validation.`}</p>
          )}
        </div>
      )}
    </div>
  );
}
