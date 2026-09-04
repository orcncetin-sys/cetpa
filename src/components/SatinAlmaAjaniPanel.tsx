/**
 * SatinAlmaAjaniPanel — Claude "Satın Alma Ajanı" (commerce-agents blueprint
 * uyarlaması, 2026-09-01). Kritik stokları son-alış tedarikçilerine göre
 * gruplanmış SAS önerisine çevirir. Rakamlar (stok/eşik/fiyat) SUNUCUDAN gelir;
 * model yalnız gerekçe + miktar önerir (guardrail: ticaretAjaniRoutes.ts).
 */
import { useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, Factory } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { authFetch } from '../services/authFetch';

interface Kalem { sku: string; urunAdi: string; onerilenMiktar: number; mevcutStok: number | null; esik: number | null; }
interface Grup { tedarikci: string; kalemler: Kalem[]; gerekce: string; }
interface Yanit {
  success: boolean; error?: string; notConfigured?: boolean; bos?: boolean; mesaj?: string;
  ozet?: string; tedarikciGruplari?: Grup[]; riskNotlari?: string[]; elenenOneri?: number;
}

export default function SatinAlmaAjaniPanel({ currentLanguage, aiOnayli }: { currentLanguage: string; aiOnayli: boolean }) {
  const tr = currentLanguage === 'tr';
  const [yukleniyor, setYukleniyor] = useState(false);
  const [sonuc, setSonuc] = useState<Yanit | null>(null);

  const calistir = async () => {
    setYukleniyor(true); setSonuc(null);
    try {
      const r = await authFetch('/api/ai/satinalma-ajani', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setSonuc(await r.json() as Yanit);
    } catch (e) {
      setSonuc({ success: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setYukleniyor(false); }
  };

  return (
    <div className="apple-card p-5 space-y-3 border border-purple-100">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-purple-100 rounded-xl"><Sparkles className="w-4 h-4 text-purple-600" /></div>
          <div>
            <h3 className="font-bold text-gray-900 text-sm">{tr ? 'AI Satın Alma Ajanı' : 'AI Purchasing Agent'}</h3>
            <p className="text-[11px] text-gray-400">{tr ? 'Kritik stokları tedarikçi bazlı SAS önerisine çevirir (Claude)' : 'Groups critical stock into supplier-based PO suggestions (Claude)'}</p>
          </div>
        </div>
        <button onClick={calistir} disabled={yukleniyor || !aiOnayli}
          className="apple-button-primary text-sm flex items-center gap-2 disabled:opacity-50">
          {/* 'working': ajan kritik stokları ve son-alış tedarikçilerini işliyor.
              20px preset satır-içi metin ölçeğinde ayrı tasarlanmıştır (ölçek değil). */}
          {yukleniyor ? <ThinkingOrb state="working" size={20} theme="light"
            aria-label={tr ? 'Öneri hazırlanıyor' : 'Preparing suggestion'} /> : <Sparkles className="w-4 h-4" />}
          {tr ? 'Öneri Üret' : 'Generate'}
        </button>
      </div>
      {!aiOnayli && (
        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
          {tr ? 'AI kullanım onayı gerekli — sağ alttaki AI asistanını ilk açışınızda onay verebilirsiniz.' : 'AI consent required — grant it when first opening the AI assistant.'}
        </p>
      )}
      {sonuc && !sonuc.success && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          {sonuc.error || (tr ? 'Öneri üretilemedi.' : 'Failed.')}
        </div>
      )}
      {sonuc?.success && sonuc.bos && <p className="text-xs text-gray-500">{sonuc.mesaj}</p>}
      {sonuc?.success && sonuc.tedarikciGruplari && (
        <div className="space-y-3">
          {sonuc.ozet && <p className="text-xs text-gray-600">{sonuc.ozet}</p>}
          {sonuc.tedarikciGruplari.map((g, i) => (
            <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Factory className="w-3.5 h-3.5 text-emerald-600" />
                <p className="font-semibold text-gray-800 text-sm">{g.tedarikci}</p>
                <span className="text-[10px] text-gray-400">{g.kalemler.length} {tr ? 'kalem' : 'items'}</span>
              </div>
              <p className="text-[11px] text-gray-500">{g.gerekce}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[420px]">
                  <thead><tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left py-1 px-1">{tr ? 'Ürün' : 'Product'}</th>
                    <th className="text-right py-1 px-1">{tr ? 'Stok/Eşik' : 'Stock/Min'}</th>
                    <th className="text-right py-1 px-1">{tr ? 'Önerilen' : 'Suggested'}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {g.kalemler.map(k => (
                      <tr key={k.sku}>
                        <td className="py-1.5 px-1"><span className="font-medium text-gray-800">{k.urunAdi}</span><span className="block text-[10px] font-mono text-gray-400">{k.sku}</span></td>
                        <td className="py-1.5 px-1 text-right tabular-nums text-red-600">{k.mevcutStok ?? '—'}/{k.esik ?? '—'}</td>
                        <td className="py-1.5 px-1 text-right tabular-nums font-bold text-gray-800">{k.onerilenMiktar}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {!!sonuc.riskNotlari?.length && (
            <div className="bg-amber-50 rounded-xl px-3 py-2 space-y-1">
              {sonuc.riskNotlari.map((n, i) => (
                <p key={i} className="text-[11px] text-amber-800 flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{n}</p>
              ))}
            </div>
          )}
          {typeof sonuc.elenenOneri === 'number' && sonuc.elenenOneri > 0 && (
            <p className="text-[10px] text-gray-400">{tr ? `${sonuc.elenenOneri} öneri katalog doğrulamasından geçemediği için elendi.` : `${sonuc.elenenOneri} suggestions failed catalog validation.`}</p>
          )}
        </div>
      )}
    </div>
  );
}
