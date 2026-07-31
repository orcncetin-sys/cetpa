/**
 * MuhasebeMenuBar.tsx — Muhasebe yatay menüsü, her yerde aynı.
 *
 * 2026-07-31: Menüdeki 6 öğe (Otomatik Hatırlatıcı, Holding, IFRS 15, Finans
 * Paneli, E-Belge Merkezi, Vergi Takvimi) `kind:'app'` hedefi, yani uygulama
 * seviyesinde AYRI sekme. Tıklayınca Muhasebe sayfasından tamamen çıkılıyor ve
 * bar da onunla kayboluyordu — kullanıcı geri dönmek için sidebar'a gitmek
 * zorunda kalıyordu.
 *
 * Bar artık ortak bileşen; o altı sayfanın başında da render edilerek menü
 * kesintisiz kalıyor. (Aynı sorunun bir varyantı 2026-07-30'da Bilanço'da
 * yaşanmıştı; orada bar AccountingModule'ün içindeydi ve sayfa seviyesine
 * taşınmıştı. Bu, o düzeltmenin geri kalanı.)
 */
import { MUHASEBE_MENU, type MuhasebeTarget } from '../lib/muhasebeMenu';

interface Props {
  currentLanguage: string;
  /** Şu an hangi öğe etkin — sayfa kendi bağlamını bilir. */
  aktifMi: (target: MuhasebeTarget) => boolean;
  /** Menüden seçim yapıldı. Sayfa hedefe göre yönlendirir. */
  onSelect: (target: MuhasebeTarget) => void;
}

export default function MuhasebeMenuBar({ currentLanguage, aktifMi, onSelect }: Props) {
  return (
    <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
      <div className="flex gap-1 p-1 bg-white/80 border border-gray-100 rounded-2xl shadow-sm w-max">
        {MUHASEBE_MENU.map(m => {
          const Icon = m.icon;
          const isActive = aktifMi(m.target);
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.target)}
              className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                isActive ? 'bg-[#ff4000] text-white shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-gray-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {currentLanguage === 'tr' ? m.tr : m.en}
            </button>
          );
        })}
      </div>
    </div>
  );
}
