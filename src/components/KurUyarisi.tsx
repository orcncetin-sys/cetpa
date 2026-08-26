import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cevrilemeyenler, cevrilemeyenMesaji, maliyetTarihleri } from '../utils/cost';
import { kurlariYukle } from '../utils/kurArsivi';
import type { InventoryItem } from '../types';

/**
 * "Bu ekrandaki maliyet toplamları EKSİK" uyarısı.
 *
 * ## Neden var
 *
 * `itemCostTRY` (src/utils/cost.ts), para birimi USD/EUR olan bir kalemin kuru
 * yoksa **0** döner — yani kalem toplama katılmaz. Bu, uydurma kur kullanmaktan
 * (eski `?? 1`: $100 maliyet ₺100 sayılıyordu) iyidir ama TEK BAŞINA sessiz bir
 * eksiltmedir: kullanıcı eksik bir toplamı dolu sanır.
 *
 * Bu bileşen o eksikliği görünür kılar. Kullanıcının kuralı (2026-08-26):
 * "kur bulunamadı hatası ver, kur gelince düzelsin" — kalıcı bir işaret
 * yazılmaz, kur geldiğinde bu uyarı kendiliğinden kaybolur.
 *
 * ## Kullanım
 *
 * Maliyet-tabanlı bir toplam gösteren her ekranın ÜSTÜNE koy. Gösterilecek bir
 * şey yoksa (her şey TL ya da kurlar tam) `null` döner — gereksiz gürültü
 * çıkarmaz, o yüzden koşulla sarmaya gerek yok.
 */
export default function KurUyarisi({
  inventory,
  exchangeRates,
  currentLanguage = 'tr',
  className,
}: {
  inventory: readonly InventoryItem[];
  exchangeRates: Record<string, number> | null | undefined;
  currentLanguage?: 'tr' | 'en' | string;
  className?: string;
}) {
  // FATURA TARİHİ KURLARINI YÜKLE. `maliyetDurumu` kuru SENKRON okur
  // (render sırasında ağ isteği olamaz), dolayısıyla tarihler önceden
  // getirilmeli. Bu bileşen maliyet gösteren her ekranın üstünde olduğu için
  // yükleme kancası da burada duruyor — her sayfaya ayrı ayrı eklenmesin.
  //
  // `sayac` yalnızca yükleme bitince YENİDEN RENDER tetiklemek için: arşiv
  // modül düzeyinde bir Map, React onu izlemez.
  const [sayac, setSayac] = useState(0);
  const tarihler = maliyetTarihleri(inventory);
  const anahtar = tarihler.join(',');
  useEffect(() => {
    if (!tarihler.length) return;
    let iptal = false;
    void kurlariYukle(tarihler).then(() => { if (!iptal) setSayac(n => n + 1); });
    return () => { iptal = true; };
    // `anahtar` tarih kümesini temsil eder; dizi kimliği her render değişir.
  }, [anahtar]);   // eslint-disable-line react-hooks/exhaustive-deps

  void sayac;   // yeniden render tetikleyicisi; değeri okunmuyor
  const ozet = cevrilemeyenler(inventory, exchangeRates);
  const mesaj = cevrilemeyenMesaji(ozet, currentLanguage === 'en' ? 'en' : 'tr');
  if (!mesaj) return null;

  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 ${className ?? ''}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="text-xs leading-relaxed">{mesaj}</p>
    </div>
  );
}
