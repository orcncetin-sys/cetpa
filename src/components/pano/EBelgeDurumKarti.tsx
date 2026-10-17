/**
 * EBelgeDurumKarti — Pano'daki hızlı durum şeridinin «E-Belge» kartı (rol kararları inceleme düzeltmesi, 2026-10-17).
 *
 * Kart e-Belge sekmesine götürür. H2'den (2026-10-11) sonra Satış ve Lojistik o sekmeyi GÖRMEZ; kart onlarda çizilseydi
 * tıklama App.tsx'in sessiz geri çevirmesine düşer, panoya döner ve hiçbir mesaj çıkmazdı (ölü giriş). Bu yüzden kart
 * sekmeye erişemeyen rolde ÇİZİLMEZ.
 *
 * Koşul rol adı taşımaz: sekme tablosundan (`canAccess`, App.tsx TAB_PERMISSIONS) sorulur. Nitelik ZORUNLU — isteğe
 * bağlı olsaydı çağıran onu geçirmeyi unutabilir, kart yine herkese çizilirdi («yazıldı ama bağlanmadı» sınıfı).
 * Çit + davranış: EBelgeDurumKarti.test.tsx. Şeridin öteki kartları (Kasa / Vergi / Bakım) ayrı karar, bu bileşende değil.
 */
import { FileText } from 'lucide-react';
import { oc } from '../../i18n/ortak';
import { dc } from '../../i18n/dashboard';

interface Props {
  /** Sekme erişimi — App.tsx'in `canAccess`'i (tam + salt okunur). Kart yalnız `canAccess('ebelge')` doğruysa çizilir. */
  canAccess: (tab: string) => boolean;
  setActiveTab: (tab: string) => void;
  gibConnected: boolean;
  currentLanguage: 'tr' | 'en';
}

export default function EBelgeDurumKarti({ canAccess, setActiveTab, gibConnected, currentLanguage }: Props) {
  if (!canAccess('ebelge')) return null;
  return (
    <button onClick={() => setActiveTab('ebelge')} className="apple-card p-4 text-left hover:shadow-md hover:scale-[1.01] transition-all group flex flex-col min-h-[120px]">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
          <FileText className="w-3.5 h-3.5 text-indigo-600" />
        </div>
        <span className="text-xs font-bold text-gray-500 uppercase truncate">{dc(currentLanguage).e_belge}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 mt-auto">
        {gibConnected
          ? (dc(currentLanguage).gib_bagli)
          : (dc(currentLanguage).gib_bagli_degil)}
      </p>
      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{dc(currentLanguage).e_fatura_e_arsiv_e_irsaliye}</p>
      <div className="flex items-center gap-1 mt-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${gibConnected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
        <span className={`text-[10px] font-semibold ${gibConnected ? 'text-green-600' : 'text-red-500'}`}>
          {gibConnected ? (oc(currentLanguage).aktif) : (dc(currentLanguage).bagli_degil)}
        </span>
      </div>
    </button>
  );
}
