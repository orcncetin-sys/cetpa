import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Firestore has been replaced by our own PostgreSQL-backed store
// (src/lib/dbClient.ts → /api/db). `db` is kept as an opaque placeholder so
// existing call sites (collection(db, ...), doc(db, ...)) keep compiling —
// dbClient ignores this first argument entirely.
export const db = {} as Record<string, never>;

export const auth = getAuth(app);
export const storage = getStorage(app);
