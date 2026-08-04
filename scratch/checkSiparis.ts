import { db } from '../src/firebase';
import { collection, getDocs, limit, query } from 'firebase/firestore';

async function check() {
  const snap = await getDocs(query(collection(db, 'mikroSiparisler'), limit(1)));
  if (!snap.empty) {
    console.log(snap.docs[0].data());
  }
}
check().catch(console.error);
