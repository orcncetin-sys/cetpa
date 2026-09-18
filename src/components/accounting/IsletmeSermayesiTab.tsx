import { motion } from 'motion/react';
import { RefreshCw } from 'lucide-react';
import { paraYaz } from '../../utils/currency';
import { oc } from '../../i18n/ortak';
// Hesap tek kaynakta (utils/muhasebe/isletmeSermayesi.ts)
import { isletmeSermayesi, wcGirdiOku, wcGirdiYaz, type WCKalemleri, type WCDurum } from '../../utils/muhasebe/isletmeSermayesi';
import { ac } from '../../i18n/accounting';

type WCField = 'kasaBanka' | 'ticariAlacaklar' | 'stoklar' | 'ticariBorclar' | 'vergiSgk' | 'krediler';

interface IsletmeSermayesiTabProps {
  currentLanguage: string;
  /** Değerler `unknown`: DB'den null/eksik gelebilir, boşaltılan alan NaN'dır — 0 DEĞİL. */
  workingCapital: WCKalemleri;
  wcSaved: boolean;
  updateWC: (field: WCField, value: number) => void;
  prefillWC: () => void;
}

export default function IsletmeSermayesiTab({ currentLanguage, workingCapital, wcSaved, updateWC, prefillWC }: IsletmeSermayesiTabProps) {
  const tr = currentLanguage === 'tr';
  const wc = workingCapital;
  // Hesap tek kaynakta (utils/muhasebe/isletmeSermayesi.ts): oranın paydası bilinmiyor ya da ≤ 0 ise
  // cariOran null ('—') — eski kod borçsuz şirkete "0.00 Riskli" basıyordu.
  const { donen: donenVarliklar, kv: kvYukumluluk, net: netSermaye, cariOran, durum } = isletmeSermayesi(wc);
  const fmt = (n: number) => paraYaz(n, { ondalik: 0 });
  const oranYaz = cariOran === null ? '—' : cariOran.toFixed(2);
  const ROZET: Record<WCDurum, { txt: string; cls: string }> = {
    ideal: { txt: ac(tr).ideal, cls: 'text-emerald-600' },
    yeterli: { txt: ac(tr).yeterli, cls: 'text-amber-600' },
    riskli: { txt: ac(tr).riskli, cls: 'text-red-600' },
    borcsuz: { txt: ac(tr).borcsuz, cls: 'text-emerald-600' },
    bilinmiyor: { txt: ac(tr).eksik_veri, cls: 'text-gray-500' },
  };
  const oranDurum = ROZET[durum];
  // DÜZ FONKSİYON, bileşen DEĞİL: render içinde tanımlanan bileşenin kimliği her render'da değişir → React
  // girdiyi yeniden bağlar ve her tuş vuruşunda odak kaybolurdu (react-hooks 'components during render').
  const wcGirdisi = (field: WCField, label: string) => (
    <div key={field} className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₺</span>
        <input type="number" value={wcGirdiYaz(wc[field])} onChange={e => updateWC(field, wcGirdiOku(e.target.value))}
          placeholder="0"
          className="w-32 pl-5 pr-2 py-1 text-xs text-right bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-brand tabular-nums" />
      </div>
    </div>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-400">
          {ac(tr).kalemleri_elle_duzenleyin_otomatik_kaydedilir}
          {wcSaved && <span className="ml-2 text-emerald-600 font-bold">✓ {oc(tr).kaydedildi_2}</span>}
        </p>
        <button onClick={prefillWC} className="apple-button-secondary text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> {ac(tr).verilerden_doldur_alacak_stok}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="apple-card p-6">
          <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">{oc(tr).donen_varliklar}</h4>
          <p className="text-2xl font-black text-gray-800 mb-4">{fmt(donenVarliklar)}</p>
          {!Number.isFinite(donenVarliklar) && <p className="-mt-3 mb-3 text-[10px] text-gray-400">{ac(tr).bazi_kalemler_girilmedi}</p>}
          <div className="space-y-3">
            {wcGirdisi('kasaBanka', ac(tr).kasa_banka)}
            {wcGirdisi('ticariAlacaklar', ac(tr).ticari_alacaklar)}
            {wcGirdisi('stoklar', ac(tr).stoklar)}
          </div>
        </div>
        <div className="apple-card p-6">
          <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">{oc(tr).kisa_vadeli_yukumlulukler}</h4>
          <p className="text-2xl font-black text-red-600 mb-4">{fmt(kvYukumluluk)}</p>
          {!Number.isFinite(kvYukumluluk) && <p className="-mt-3 mb-3 text-[10px] text-gray-400">{ac(tr).bazi_kalemler_girilmedi}</p>}
          <div className="space-y-3">
            {wcGirdisi('ticariBorclar', oc(tr).ticari_borclar)}
            {wcGirdisi('vergiSgk', ac(tr).vergi_sgk)}
            {wcGirdisi('krediler', ac(tr).kisa_vadeli_krediler)}
          </div>
        </div>
        <div className="apple-card bg-brand p-6 text-white">
          <h4 className="text-xs font-bold opacity-70 uppercase mb-2">{ac(tr).net_isletme_sermayesi}</h4>
          <p className="text-3xl font-black">{fmt(netSermaye)}</p>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs opacity-70">{oc(tr).cari_oran}:</span>
            <span className="text-lg font-black">{oranYaz}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-white ${oranDurum.cls}`}>{oranDurum.txt}</span>
          </div>
          <div className="mt-4 p-3 bg-white/10 rounded-xl">
            <p className="text-[10px] font-medium leading-relaxed">
              {durum === 'bilinmiyor'
                ? (ac(tr).bazi_kalemler_girilmedi_cari_oran_hesaplanamiyor)
                : donenVarliklar === 0 && kvYukumluluk === 0
                  ? (ac(tr).kalemleri_girerek_isletme_sermayenizi_hesaplayin)
                  : durum === 'borcsuz'
                    ? (ac(tr).kisa_vadeli_yukumluluk_yok_cari_oran_tanimsiz)
                    : durum === 'ideal'
                      ? (tr ? `İşletme sermayesi rasyosu ${oranYaz} ile ideal seviyededir. Likidite riski düşüktür.` : `Working capital ratio is ideal at ${oranYaz}. Low liquidity risk.`)
                      : (tr ? `Cari oran ${oranYaz} — likiditeyi yakından izleyin.` : `Current ratio ${oranYaz} — monitor liquidity closely.`)}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
