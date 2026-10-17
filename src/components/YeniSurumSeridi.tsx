/**
 * YeniSurumSeridi.tsx — «Yeni sürüm yayında» şeridi (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S3, S4, S6).
 *
 * App kökünde, hata sınırının DIŞINDA bağlanır (src/App.tsx `App`): her sayfada — giriş ekranı, dış rol sayfası, herkese açık
 * sayfalar dâhil — aynı şerit; uygulama içeriği çökse de şerit kalır. Karar ve zamanlama src/lib/yeniSurum.ts'te.
 *
 *  • Ekranın altında, kalıcı (kendiliğinden kaybolmaz), kapatılabilir. «Yenile» = `location.reload()`; kendiliğinden yenileme YOK.
 *  • Erişilebilirlik: `role="status"` canlı bölge HER ZAMAN sayfadadır (içerik değişince okunur; sonradan eklenen bölgeyi bazı
 *    ekran okuyucular duyurmaz). Odak çalınmaz, odak tuzağı yok: düğmeler sayfanın olağan sekme sırasındadır.
 *  • Dil: `<html lang>` (App seçili dile göre günceller) — şerit App'in dil durumuna erişmeden iki dilde de doğru.
 *  • Katman `z-[65]` — modal katmanının (`z-[100]`: ConfirmModal, Add*Modal, …) ALTINDA, açık bir pencerenin düğmelerini
 *    örtmez. Değer `src/`'deki `z-[60]`…`z-[99]` öğeleri ölçülerek seçildi (2026-10-17): altta sabit duran tek öğe
 *    SabitKiymetModule bildirimi `z-[60]` (bottom-6) → onun üstünde; AccountingModule ayrıntı / PDF pencereleri `z-[70]` /
 *    `z-[80]` → altlarında; bildirim menüsünün tıklama perdesi `z-[99]` → altında (menü açıkken şeride tıklamak menüyü kapatır,
 *    sayfanın geri kalanı gibi). Bedeli: iç içe açılan `z-[60]` pencereleri (MikroFaturaDetay, ProductDetail hareket ayrıntısı)
 *    ve `z-50` pencereler şeridin altında kalır. İSTİSNA (inceleme 2, Y5): kullanıcının açtığı AIChat sohbet penceresi «altta
 *    sabit duran öğe» değildir — şeridin üstünde olsun diye `z-50` → `z-[69]` alındı (`z-[70]`+ sayfa modallarının ve modal katmanının altında; `z-[60]`
 *    MikroFaturaDetay / ProductDetail hareket ayrıntısının üstünde, şerit gibi); açma düğmesi `z-50`
 *    kalır (`pb-24` onu açıkta bırakır). Y3 taraması bu pencereyi adı ve gerekçesiyle hariç tutar. Değerler
 *    YeniSurumSeridi.test.tsx'te sabit.
 *  • Alt boşluk `pb-24` (6rem): `bottom-6` sabit düğmelerin (OrdersPage toplu işlem çubuğu, AIChat, «Başa dön»; en yükseği
 *    AIChat düğmesi: 1,5rem + 3,5rem = 5rem) ÜSTÜNDE durur, onları örtmez. Toast'un (Toast.tsx, `bottom-6`) ikinci balonunun
 *    şeride binmesi kabul.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { gomuluSurumuOku, seritDeposu, surumDenetimiBaslat, type SeritDeposu } from '../lib/yeniSurum';
import { yeniSurumMetni } from '../i18n/yeniSurum';

function sayfaDiliAbone(bildir: () => void): () => void {
  const gozcu = new MutationObserver(bildir);
  gozcu.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return () => gozcu.disconnect();
}
const sayfaDili = (): string => document.documentElement.lang;

export interface YeniSurumSeridiProps {
  /** Sınamalar kendi deposunu verir; uygulamada sekmenin tek deposu. */
  depo?: SeritDeposu;
  /** Sınamada sahte yenileme; uygulamada `location.reload()`. */
  yenile?: () => void;
}

export default function YeniSurumSeridi({ depo = seritDeposu, yenile }: YeniSurumSeridiProps) {
  const durum = useSyncExternalStore(depo.abone, depo.durum, depo.durum);
  const dil = useSyncExternalStore(sayfaDiliAbone, sayfaDili, () => 'tr');
  useEffect(() => surumDenetimiBaslat({ gomulu: gomuluSurumuOku(document), depo }), [depo]);
  const m = yeniSurumMetni(dil);
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[65] flex justify-center px-4 pb-24 pointer-events-none"
    >
      {durum && (
        <div className="pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-2xl bg-gray-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur">
          <RefreshCw className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
          <p className="flex-1 text-sm font-medium leading-snug">
            {durum.tur === 'sayfa-yenileme' ? m.bu_sayfa_icin_yenileme_gerekiyor : m.yeni_surum_yayinda}
          </p>
          <button
            type="button"
            onClick={() => { if (yenile) yenile(); else window.location.reload(); }}
            className="shrink-0 rounded-xl bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {m.yenile}
          </button>
          <button
            type="button"
            aria-label={m.bildirimi_kapat}
            title={m.bildirimi_kapat}
            onClick={() => depo.kapat()}
            className="shrink-0 rounded-lg p-1 text-gray-300 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
