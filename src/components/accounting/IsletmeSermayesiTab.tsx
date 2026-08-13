import { motion } from 'motion/react';
import { RefreshCw } from 'lucide-react';

type WCField = 'kasaBanka' | 'ticariAlacaklar' | 'stoklar' | 'ticariBorclar' | 'vergiSgk' | 'krediler';

interface IsletmeSermayesiTabProps {
  currentLanguage: string;
  workingCapital: Record<WCField, number>;
  wcSaved: boolean;
  updateWC: (field: WCField, value: number) => void;
  prefillWC: () => void;
}

export default function IsletmeSermayesiTab({ currentLanguage, workingCapital, wcSaved, updateWC, prefillWC }: IsletmeSermayesiTabProps) {
  const tr = currentLanguage === 'tr';
  const wc = workingCapital;
  const donenVarliklar = wc.kasaBanka + wc.ticariAlacaklar + wc.stoklar;
  const kvYukumluluk = wc.ticariBorclar + wc.vergiSgk + wc.krediler;
  const netSermaye = donenVarliklar - kvYukumluluk;
  const cariOran = kvYukumluluk > 0 ? donenVarliklar / kvYukumluluk : 0;
  const fmt = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`;
  const oranDurum = cariOran >= 1.5 ? { txt: tr ? 'İdeal' : 'Ideal', cls: 'text-emerald-600' }
    : cariOran >= 1 ? { txt: tr ? 'Yeterli' : 'Adequate', cls: 'text-amber-600' }
    : { txt: tr ? 'Riskli' : 'At risk', cls: 'text-red-600' };
  const WCInput = ({ field, label }: { field: WCField; label: string }) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₺</span>
        <input type="number" value={wc[field] || ''} onChange={e => updateWC(field, Number(e.target.value) || 0)}
          placeholder="0"
          className="w-32 pl-5 pr-2 py-1 text-xs text-right bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-brand tabular-nums" />
      </div>
    </div>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-400">
          {tr ? 'Kalemleri elle düzenleyin — otomatik kaydedilir.' : 'Edit items manually — auto-saved.'}
          {wcSaved && <span className="ml-2 text-emerald-600 font-bold">✓ {tr ? 'Kaydedildi' : 'Saved'}</span>}
        </p>
        <button onClick={prefillWC} className="apple-button-secondary text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> {tr ? 'Verilerden Doldur (Alacak + Stok)' : 'Fill from Data (AR + Stock)'}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="apple-card p-6">
          <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">{tr ? 'Dönen Varlıklar' : 'Current Assets'}</h4>
          <p className="text-2xl font-black text-gray-800 mb-4">{fmt(donenVarliklar)}</p>
          <div className="space-y-3">
            <WCInput field="kasaBanka" label={tr ? 'Kasa/Banka' : 'Cash/Bank'} />
            <WCInput field="ticariAlacaklar" label={tr ? 'Ticari Alacaklar' : 'Trade Receivables'} />
            <WCInput field="stoklar" label={tr ? 'Stoklar' : 'Inventory'} />
          </div>
        </div>
        <div className="apple-card p-6">
          <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">{tr ? 'Kısa Vadeli Yükümlülükler' : 'Current Liabilities'}</h4>
          <p className="text-2xl font-black text-red-600 mb-4">{fmt(kvYukumluluk)}</p>
          <div className="space-y-3">
            <WCInput field="ticariBorclar" label={tr ? 'Ticari Borçlar' : 'Trade Payables'} />
            <WCInput field="vergiSgk" label={tr ? 'Vergi/SGK' : 'Tax/Social Sec.'} />
            <WCInput field="krediler" label={tr ? 'Kısa Vadeli Krediler' : 'Short-term Loans'} />
          </div>
        </div>
        <div className="apple-card bg-brand p-6 text-white">
          <h4 className="text-xs font-bold opacity-70 uppercase mb-2">{tr ? 'Net İşletme Sermayesi' : 'Net Working Capital'}</h4>
          <p className="text-3xl font-black">{fmt(netSermaye)}</p>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs opacity-70">{tr ? 'Cari Oran' : 'Current Ratio'}:</span>
            <span className="text-lg font-black">{cariOran.toFixed(2)}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-white ${oranDurum.cls}`}>{oranDurum.txt}</span>
          </div>
          <div className="mt-4 p-3 bg-white/10 rounded-xl">
            <p className="text-[10px] font-medium leading-relaxed">
              {kvYukumluluk === 0 && donenVarliklar === 0
                ? (tr ? 'Kalemleri girerek işletme sermayenizi hesaplayın.' : 'Enter items to compute your working capital.')
                : cariOran >= 1.5
                  ? (tr ? `İşletme sermayesi rasyosu ${cariOran.toFixed(2)} ile ideal seviyededir. Likidite riski düşüktür.` : `Working capital ratio is ideal at ${cariOran.toFixed(2)}. Low liquidity risk.`)
                  : (tr ? `Cari oran ${cariOran.toFixed(2)} — likiditeyi yakından izleyin.` : `Current ratio ${cariOran.toFixed(2)} — monitor liquidity closely.`)}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
