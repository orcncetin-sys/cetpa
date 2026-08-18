/**
 * errorLogger.ts — yakalanmamış client hatalarını Firestore'a yazar.
 *
 * Harici servis (Sentry vb.) gerektirmez; hatalar `clientErrors`
 * koleksiyonunda birikir. Admin > Sistem ekranından incelenebilir.
 * Aynı hata mesajı 5 dakika içinde bir kez yazılır (flood koruması).
 */

import { addDoc, collection, serverTimestamp } from '../lib/dbClient';
import { getAuth } from 'firebase/auth';
import { db } from '../firebase';
import { setErrorReporter } from '../lib/errorSink';

const recent = new Map<string, number>();
const DEDUP_MS = 5 * 60 * 1000;

function report(kind: string, message: string, stack?: string, extra?: Record<string, unknown>) {
  try {
    const key = `${kind}|${message}`.slice(0, 200);
    const now = Date.now();
    if ((recent.get(key) ?? 0) > now - DEDUP_MS) return;
    recent.set(key, now);

    addDoc(collection(db, 'clientErrors'), {
      kind,
      message: message.slice(0, 1000),
      stack: (stack ?? '').slice(0, 3000),
      url: window.location.href,
      userAgent: navigator.userAgent,
      userId: getAuth().currentUser?.uid ?? null,
      userEmail: getAuth().currentUser?.email ?? null,
      ...extra,
      timestamp: serverTimestamp(),
    }).catch(() => { /* hata kaydı hatası sessizce yutulur */ });
  } catch { /* asla uygulamayı kırma */ }
}

export function initErrorLogger(): void {
  // Yutulan hatalari da bu hatta bagla (dbClient -> errorSink -> burasi):
  // boylece listener/akis arizalari da clientErrors'a dusup Operasyon
  // Bekcisi'nin client_errors kontrolunde gorunur olur.
  setErrorReporter((kind, message, stack, extra) => report(kind, message, stack, extra));

  window.addEventListener('error', (e) => {
    report('error', e.message || 'Unknown error', e.error?.stack, {
      source: `${e.filename ?? ''}:${e.lineno ?? 0}`,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    report('unhandledrejection', message, reason instanceof Error ? reason.stack : undefined);
  });
}
