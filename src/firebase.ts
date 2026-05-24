import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// experimentalAutoDetectLongPolling (recommended in Firebase SDK ≥12) lets
// the SDK choose between WebChannel and long-polling automatically, avoiding
// the INTERNAL ASSERTION FAILED (b815 / ca9 / ve:-1) errors that occur when
// many simultaneous onSnapshot listeners are registered on a forced
// long-polling connection.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const storage = getStorage(app);
