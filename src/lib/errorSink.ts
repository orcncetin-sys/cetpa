/**
 * errorSink.ts — sessizce yutulan hataların TEK toplanma noktası.
 *
 * SORUN (2026-08-18 kurul denetimi): uygulamanın hata karşısındaki varsayılan
 * davranışı "hiçbir şey gösterme"ydi. Somut örnekler:
 *   • 234 `onSnapshot` çağrısının 87'sinde hata geri çağrısı YOK — dbClient
 *     shim'i `error?.(e)` yazdığı için geri çağrı verilmemişse hata yutuluyor.
 *   • SSE akışı koptuğunda sessizce yeniden bağlanılıyor; kalıcı koparsa
 *     uygulama sonsuza kadar bayat veri gösterir, kullanıcı da geliştirici de
 *     bunu bilmez.
 *
 * errorLogger.ts zaten `clientErrors` koleksiyonuna yazıyor ve Operasyon
 * Bekçisi bunu izliyor (`client_errors` kontrolü) — ama yalnızca YAKALANMAMIŞ
 * hataları görüyordu. Bu modül yutulan hataları da o hattın içine sokar:
 *   yutulan hata → errorSink → errorLogger → clientErrors → Bekçi → uyarı
 *
 * DÖNGÜSEL İMPORT ENGELİ: errorLogger, dbClient'tan `addDoc` alıyor. Bu yüzden
 * dbClient errorLogger'ı DOĞRUDAN import EDEMEZ. Bu modül nötr bir ara katman:
 * dbClient buraya yazar, errorLogger açılışta kendini buraya kaydeder.
 */

export type HataRaporlayici = (
  kind: string,
  message: string,
  stack?: string,
  extra?: Record<string, unknown>,
) => void;

let raporlayici: HataRaporlayici | null = null;

/** errorLogger açılışta çağırır. */
export function setErrorReporter(fn: HataRaporlayici | null): void {
  raporlayici = fn;
}

/**
 * Yutulmuş bir hatayı bildirir. Raporlayıcı bağlı değilse bile en azından
 * konsola düşer — hiçbir koşulda tamamen sessiz kalmaz.
 * Raporlayıcının kendisi patlarsa yutulur: hata bildirimi uygulamayı kırmamalı.
 */
export function reportSilentError(
  kind: string,
  message: string,
  stack?: string,
  extra?: Record<string, unknown>,
): void {
  try { console.error(`[${kind}] ${message}`, extra ?? ''); } catch { /* konsol yoksa */ }
  try { raporlayici?.(kind, message, stack, extra); } catch { /* asla uygulamayı kırma */ }
}
