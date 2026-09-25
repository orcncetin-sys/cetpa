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
 *
 * ## 6b EKİ (2026-09-24, Faz 3 6/n Genel I) — `katYaz` + `gunYaz` (ADDITIVE; `yuzdeYaz` DOKUNULMADI)
 * Siteler (HEAD 912d750):
 *   src/components/reports/genel/GenelBloklar3.tsx:580  `{s.toFixed(1)}x`                      → TR arayüzde NOKTA ('1.2x')
 *   src/components/reports/genel/GenelBloklar3.tsx:342  `${inventoryTurnover.toFixed(1)}x`     → :338 `: 0` ile veri yokken '0.0x'
 *   src/components/reports/genel/GenelBloklar1.tsx:326/:330/:334  `{avgCycle} {oc(currentLanguage).gun}` → sayı kapısı yok:
 *        :306 NaN → "NaN gün"; :307 `Math.min(...[])` → "Infinity gün" (bugün :305 kapısı koruyor; kural yardımcıya iner)
 *   (GB3:346 `Est. DSO` ve :487-490 dört `days` sitesi K14 ile KALDIRILIYOR — `gunYaz` tüketicisi DEĞİL.)
 * PARİTE: bilinen girdide metin eskiyle BİREBİR — `katYaz(x, 1, 'en')` = `toFixed(1) + 'x'`; `gunYaz(x, 0, dil)` =
 *   `Math.round(x)` + tek boşluk + `oc(dil).gun` (yarım YUKARI yuvarlama `Math.round` ile aynı).
 * BİLİNÇLİ FARK: bilinmeyen (null/undefined/NaN/±Infinity) → '—'; '0,0x' / '0 gün' / 'NaN gün' / 'Infinity gün' UYDURULMAZ.
 *   TR ondalık ayracı VİRGÜL (`toFixed` nokta basardı). Parametre sırası `(değer, ondalik, dil)` = `yuzdeYaz` —
 *   PLAN.md:164 taslağı `gunYaz(g, dil)` diyordu; tek dosyada iki farklı sıra hata kaynağıdır (bilinçli sapma).
 * `oc()` içe aktarımı (ölçüldü): `src/i18n/ortak.ts`in kendi `import`u YOK → döngü riski yok; `'gün'`/`'d'` çifti
 *   sözlükte BİREBİR var (anahtar `gun`) ve tüketici yüzey zaten onu basıyor. `kapsamNotu.ts`in "birim adları için
 *   `oc()` KULLANILMIYOR" gerekçesi (iyelik ekleri + 'order(s)' farkı) BURADA GEÇERSİZ. `katYaz`ın 'x'i sözlükte yok,
 *   iki dilde aynı simge → satır içi. Intl seçenekleri `yuzdeYaz` ile AYNI; o gövde KAPALI olduğu için ortak
 *   `sabitOndalik` yardımcısına BAĞLANMADI (6k'da tek yardımcıya indirgenebilir — `yuzdeYaz` testleri sabit).
 */
import { bilinenSayi } from '../para';
import { oc } from '../../i18n/ortak';

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

// ─────────────────────────────────────────────────────────────────────────────
// Kat ve gün metni (6b eki, 2026-09-24)
// ─────────────────────────────────────────────────────────────────────────────

/** `yuzdeYaz` ile AYNI Intl seçenekleri: yerel ondalık ayracı, sabit basamak, binlik ayracı YOK. */
function sabitOndalik(sayi: number, ondalik: number, dil: 'tr' | 'en'): string {
  return sayi.toLocaleString(dil === 'tr' ? 'tr-TR' : 'en-US', {
    minimumFractionDigits: ondalik,
    maximumFractionDigits: ondalik,
    useGrouping: false,
  });
}

/**
 * Kat (çarpan) metni: `1.2` → '1,2x' (tr) / '1.2x' (en). Bilinmeyen → '—'.
 * Endeks/devir hızı gibi TÜRETİLEN sayılar için; oranı HESAPLAMAZ (`raporMarj`/`finansKpi` tarafı `null` döndürür).
 * Kapı `para.bilinenSayi` (içi `Number.isFinite` — global `isFinite(null)` TRUE döner ve '0,0x' bastırırdı).
 * Meşru `0` gerçek sıfırdır → '0,0x'. Negatif işaret korunur; `+` öneki EKLENMEZ.
 */
export function katYaz(kat: number | null | undefined, ondalik = 1, dil: 'tr' | 'en' = 'tr'): string {
  if (!bilinenSayi(kat)) return '—';
  return `${sabitOndalik(kat, ondalik, dil)}x`;
}

/**
 * Gün metni: `12` → '12 gün' (tr) / '12 d' (en). Bilinmeyen → '—'.
 * Birim ORTAK sözlükten (`oc(dil).gun`) — ekrandaki metin bugünkü `{x} {oc(currentLanguage).gun}` ile BİREBİR;
 * sayı ile birim arasında TEK boşluk. Yuvarlama `Math.round` paritesi (12,5 → 13). Negatif SAKLANMAZ
 * (teslim tarihi kurulumdan önceyse çağıran eler — `teslimSureleri` `kapsamDisi`).
 */
export function gunYaz(gun: number | null | undefined, ondalik = 0, dil: 'tr' | 'en' = 'tr'): string {
  if (!bilinenSayi(gun)) return '—';
  return `${sabitOndalik(gun, ondalik, dil)} ${oc(dil).gun}`;
}
