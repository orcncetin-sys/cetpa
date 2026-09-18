// Paylaşılan yardımcılar — AccountingModule.tsx'ten bölünen tüm sekme dosyaları bunları buradan alır,
// her dosyada yeniden tanımlanmaz/tekrar keşfedilmez.
// GERÇEK TANIMLAR BURADA (Faz 3 2/n, 2026-09-18): eskiden bu dosya `export … from '../AccountingModule'`
// diyen bir barrel'dı — sekme → shared → AccountingModule → sekme DÖNGÜSÜ. AccountingModule artık bunları
// buradan import eder; sözlük src/i18n/accounting.ts'te (`ac()`), tip oradan yeniden dışa aktarılır.
import { TrendingUp } from 'lucide-react';
import { paraYaz } from '../../utils/currency';

export type { AccountingT } from '../../i18n/accounting';

// --- SortHeader Component ---
export const SortHeader = ({ 
  label, 
  sortKey, 
  currentSort, 
  onSort, 
  className 
}: { 
  label: string, 
  sortKey: string, 
  currentSort: { key: string, direction: 'asc' | 'desc' }, 
  onSort: (key: string) => void,
  className?: string
}) => {
  const isActive = currentSort.key === sortKey;
  const cn = (...classes: unknown[]) => classes.filter(Boolean).join(' ');
  
  return (
    <th 
      className={cn(
        "px-4 py-3 text-left text-[10px] font-bold text-[#86868B] uppercase tracking-wider cursor-pointer hover:bg-gray-100/50 transition-colors group",
        className
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        <TrendingUp 
          className={cn(
            "w-3 h-3 transition-all",
            isActive ? "text-[#ff4000] opacity-100" : "text-gray-300 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100",
            isActive && currentSort.direction === 'desc' ? "rotate-180" : ""
          )} 
        />
      </div>
    </th>
  );
};

export const HESAP_PLANI = [
  '100 - Kasa', '102 - Bankalar', '108 - Diğer Hazır Değerler',
  '120 - Alıcılar', '121 - Alacak Senetleri', '153 - Ticari Mallar',
  '191 - İndirilecek KDV', '195 - İş Avansları', '197 - Sayım ve Tesellüm Noksanları',
  '200 - Arazi ve Arsalar', '253 - Tesis, Makine ve Cihazlar', '254 - Taşıtlar',
  '255 - Demirbaşlar', '257 - Birikmiş Amortismanlar', '291 - Gelecek Yıllara Ait Giderler',
  '320 - Satıcılar', '321 - Borç Senetleri', '360 - Ödenecek Vergi ve Fonlar',
  '361 - Ödenecek Sosyal Güvenlik Kesintileri',
  '370 - Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları',
  '391 - Hesaplanan KDV', '400 - Banka Kredileri', '420 - Uzun Vadeli Kredi',
  '500 - Sermaye', '570 - Geçmiş Yıllar Kârları', '590 - Dönem Net Kârı',
  '600 - Yurt İçi Satışlar', '610 - Satıştan İadeler',
  '620 - Satılan Ticari Mallar Maliyeti', '630 - Araştırma ve Geliştirme Giderleri',
  '631 - Pazarlama, Satış ve Dağıtım Giderleri', '632 - Genel Yönetim Giderleri',
  '640 - İştiraklerden Temettü Gelirleri', '642 - Faiz Gelirleri',
  '653 - Komisyon Giderleri', '660 - Kısa Vadeli Borçlanma Giderleri',
  '680 - Çalışmayan Kısım Gid. ve Zararları', '689 - Diğer Olağandışı Gider ve Zararlar',
  '690 - Dönem Kârı veya Zararı',
];

// Bilinmeyen (null/undefined/NaN) '—' basılır — paraYaz'ın sözleşmesi; tip bunu gizlemesin diye geniş.
export const formatTRY = (n: number | null | undefined) => paraYaz(n);

export const formatCurrency = (n: number, currency: string = 'TRY') => paraYaz(n, { birim: currency });

export const exportCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
  const bom = '\uFEFF';
  const csv = bom + [headers, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};
