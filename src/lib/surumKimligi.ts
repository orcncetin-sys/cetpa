/**
 * surumKimligi.ts — «yeni sürüm var, yenile» bildiriminin ORTAK sabitleri (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S1–S3).
 *
 * Üç taraf bu dosyadan okur, kimliğin biçimi ve yeri tek kaynakta durur:
 *  • derleme   — `src/derleme/surumEklentisi.ts` (Vite eklentisi): kimliği üretir, `index.html`'e `<meta name="cetpa-surum">`
 *                olarak gömer ve çıktı dizinine `surum.json` yazar;
 *  • sunucu    — `src/server/routes/surumRoutes.ts`: `dist/surum.json`'u okur, `GET /api/surum` ile verir;
 *  • istemci   — `src/lib/yeniSurum.ts`: gömülü kimliği sayfadan okur, sunucununkiyle karşılaştırır.
 *
 * Tarayıcıda da yüklenir: Node'a özgü içe aktarma YOK (karma hesabı eklentinin kendisinde).
 */

/** İstemcinin sorduğu, sunucunun verdiği uç. Kimliksizdir; yanıt yalnız `{ surum }`. */
export const SURUM_UCU = '/api/surum';
/** Derleme çıktı dizinindeki (canlıda `dist/`, hızlı yolda önce `dist.new/`) sürüm dosyası. */
export const SURUM_DOSYASI = 'surum.json';
/** `index.html`'deki gömülü kimliğin `<meta name="…">` adı. */
export const SURUM_META_ADI = 'cetpa-surum';

/** Kimlik biçimi: eklenti 16 haneli küçük harfli onaltılık karma üretir; okuyan taraflar yalnız bu biçimi kabul eder. */
const SURUM_DESENI = /^[0-9a-f]{16}$/;

/** Değer geçerli bir sürüm kimliği mi? Geçersiz / eksik kimlik «bilinmiyor» sayılır (bildirim çıkmaz). */
export function surumGecerli(deger: unknown): deger is string {
  return typeof deger === 'string' && SURUM_DESENI.test(deger);
}
