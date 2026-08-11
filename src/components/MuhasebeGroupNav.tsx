/**
 * MuhasebeGroupNav.tsx — Muhasebe grubunun üst gezinme şeridi.
 *
 * Neden var: bu şerit App.tsx içinde E-Belge Merkezi ve Vergi Takvimi
 * ekranlarına AYRI AYRI kopyalanmıştı (yalnız aktif düğme farklıydı). Gruba
 * yeni bir sayfa eklenince iki yeri de güncellemek gerekiyordu; biri unutulunca
 * menü ekranlar arasında tutarsız kalıyordu — "depo iki menüde" arıza sınıfının
 * aynısı. Tek kaynak: burası.
 */
import { BookOpen, FileText, Receipt } from 'lucide-react';

export type MuhasebeGrupSekmesi = 'muhasebe' | 'ebelge' | 'vergi';

interface Props {
  /** Şu an açık olan ekran — o düğme vurgulanır, tıklanamaz. */
  aktif: MuhasebeGrupSekmesi;
  currentLanguage: string;
  onNavigate: (tab: MuhasebeGrupSekmesi) => void;
}

const PASIF = 'shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100 transition-all whitespace-nowrap';
const AKTIF = 'shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-brand text-white shadow-sm whitespace-nowrap';

export default function MuhasebeGroupNav({ aktif, currentLanguage, onNavigate }: Props) {
  const tr = currentLanguage === 'tr';
  const sekmeler = [
    { id: 'muhasebe' as const, icon: BookOpen, label: tr ? 'Muhasebe & Finans' : 'Accounting & Finance' },
    { id: 'ebelge'   as const, icon: FileText, label: tr ? 'E-Belge Merkezi'   : 'E-Document Hub' },
    { id: 'vergi'    as const, icon: Receipt,  label: tr ? 'Vergi Takvimi'     : 'Tax Calendar' },
  ];

  return (
    <div className="overflow-x-auto scrollbar-none">
      <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
        {sekmeler.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={id === aktif ? undefined : () => onNavigate(id)}
            className={id === aktif ? AKTIF : PASIF}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
