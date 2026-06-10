/**
 * auditLog.ts — client-side audit logging helper.
 *
 * Writes to the same `auditLog` collection the server uses, so every
 * user action shows up in Admin > Denetim Kaydı. Fire-and-forget:
 * failures are logged to console, never block the UI.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../firebase';

export function logAudit(action: string, details: string): void {
  const user = getAuth().currentUser;
  if (!user) return;
  addDoc(collection(db, 'auditLog'), {
    action,
    details,
    userId:    user.uid,
    companyId: user.uid,
    userName:  user.displayName || user.email || 'Bilinmiyor',
    userEmail: user.email || '',
    source:    'client',
    timestamp: serverTimestamp(),
  }).catch(e => console.warn('[auditLog]', e));
}
