/**
 * bicim.ts — rapor yüzeylerinin METİN biçimi, tek kaynak (Faz 3 6/n a, 2026-09-19).
 * Test: bicim.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR — rapor ekranlarında yüzde metni her yerde elle kuruluyor ve bilinmeyeni SAYI gibi basıyor
 * (CLAUDE.md: sayısal alanda sahte kesinlik YASAK — bilinmeyen 0 değil BİLİNMİYORdur):
 *   src/pages/RaporlarPage.tsx:177  PDF durum dağılımı  `${orders.length > 0 ? Math.round(...) : 0}%`  → sipariş yokken '0%'
 *   src/pages/RaporlarPage.tsx:364  P570 Lead Dönüşüm   `v.toFixed(1) + '%'`                           → girdi NaN ise 'NaN%'
 *   src/pages/RaporlarPage.tsx:656  P631 aşama oranı    `${Math.round(p.count / total631 * 100)}%`      → total 0 ise 'NaN%'
 *   src/pages/RaporlarPage.tsx:700  P631 darboğaz oranı `${Math.round((bottleneck?.count || 0) / total631 * 100)}%`
 * Sonraki alt fazlarda ~40 benzer site ('NaN%', '0.0%', '+0.0%') buraya bağlanacak.
 *
 * PARİTE: bilinen girdide sayı ESKİYLE BİREBİR — işaret SONDA ('42%'), binlik ayracı yok, `+` öneki yok.
 * Değişen TEK davranış: girdi bilinmiyorsa (null/undefined/NaN/±Infinity) '—' — eskiden 'NaN%' / '0%' basılıyordu.
 *
 * BİLİNÇLİ FARK — İKİ yüzde biçimi yaşar, biri öbürüne İNDİRGENMEZ:
 *   • `muhasebe/mizan.kdvOranYaz` → '%20'  (işaret ÖNDE; Muhasebe KAPALI modül, DOKUNULMAZ — KDV oranı rozeti/CSV)
 *   • `rapor/bicim.yuzdeYaz`      → '42%'  (işaret SONDA; mevcut rapor yüzeyleriyle parite)
 *   `yuzdeYaz` KDV oranı için KULLANILMAZ. TR'de hizalamayı '%42'ye çevirmek ~40 sitede GÖRÜNÜR değişikliktir →
 *   kullanıcı kararı olmadan yapılmaz (DEVREDEN 6m).
 *
 * Oran HESABI burada DEĞİL: `finansKpi.yuzdeOrani` (yuvarlanmış), `lojistikKpi.oranYuzde` (ham),
 * `kpiTrend.hedefOrani` yerinde kalır — bu modül yalnız hazır oranı METNE çevirir.
 *
 * 6b adım 0'da `katYaz`/`gunYaz`, 6k adım 0'da `metinSirala` bu dosyaya ADDITIVE eklenecek.
 */
import { bilinenSayi } from '../para';

/**
 * Hazır yüzde oranını ekran/PDF metnine çevirir: `42` → '42%', `12.34, 1, 'en'` → '12.3%'.
 *
 * Bilinmeyen (`null` / `undefined` / `NaN` / `±Infinity`) → '—'. Kapı `para.bilinenSayi` (Faz 1'den testli
 * TEK kaynak; içi `Number.isFinite`) — burada KOPYALANMAZ. `Number.isFinite` ŞART: global `isFinite(null)`
 * TRUE döner (Number(null) === 0) ve bilinmeyen oranı '0%' diye bastırırdı. Meşru `0` gerçek sıfırdır → '0%'.
 *
 * Ondalık ayracı YEREL (`tr` → virgül, `en` → nokta; Faz 2 para biçimiyle aynı karar) — `toFixed`
 * TR arayüzde nokta basardı. Binlik ayracı YOK (`useGrouping: false`): %1250 oranı '1.250%' okunmaz.
 * Pozitife `+` öneki EKLENMEZ — değişim rozetleri kendi önekini koyar.
 *
 * Not: yuvarlamayla sıfıra inen NEGATİF değer işaretini korur (`-0.04` → 1 ondalıkla '-0,0%').
 * Bugünkü dört çağıran yalnız negatif olmayan oran geçiriyor; kırpma kuralı kullanıcı kararı ister.
 *
 * @param oran  Hazır yüzde değeri (0-100 aralığı zorunlu değil; kırpılmaz, hesaplanmaz).
 * @param ondalik Basılacak ondalık basamak sayısı (sabit: min = max).
 * @param dil Çağıranda dil `string` ise (`currentLanguage`) `currentLanguage === 'tr' ? 'tr' : 'en'` daraltması yapılır.
 */
export function yuzdeYaz(
  oran: number | null | undefined,
  ondalik = 0,
  dil: 'tr' | 'en' = 'tr',
): string {
  if (!bilinenSayi(oran)) return '—';
  const metin = oran.toLocaleString(dil === 'tr' ? 'tr-TR' : 'en-US', {
    minimumFractionDigits: ondalik,
    maximumFractionDigits: ondalik,
    useGrouping: false,
  });
  return `${metin}%`;
}
