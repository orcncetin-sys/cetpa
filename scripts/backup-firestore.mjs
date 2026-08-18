/**
 * backup-firestore.mjs — kritik Firestore koleksiyonlarını JSON'a yedekler.
 *
 * Container içinden çalışır (firebase-admin + env creds hazır):
 *   docker exec cetpa-app node scripts/backup-firestore.mjs
 *
 * Çıktı: /app/backups/YYYY-MM-DD/<koleksiyon>.json
 * VDS cron'u /opt/cetpa/backups'a mount edilmiş dizine yazar ve
 * 7 günden eski yedekleri siler.
 */

// firebase-admin 14 namespace API'sini kaldirdi (admin.credential / admin.storage /
// admin.firestore artik yok) — moduler alt-yol importlari sart.
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';

const PROJECT_ID = 'gen-lang-client-0628151245';
const DB_ID = 'ai-studio-d243947a-133d-4934-af2e-eff3bb6aeea7';

const COLLECTIONS = [
  'inventory', 'leads', 'orders', 'quotations', 'shipments',
  'warehouseItems', 'warehouses', 'categories', 'priceLists',
  'employees', 'payrolls', 'journalEntries', 'bankAccounts', 'kasalar',
  'contracts', 'purchaseOrders', 'suppliers', 'skuMappings',
  'settings', 'users', 'auditLog', 'syncLog',
];

const RETENTION_DAYS = 7;

const fbEmail = process.env.FIREBASE_CLIENT_EMAIL;
const fbKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
if (!fbEmail || !fbKey) {
  console.error('FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY eksik.');
  process.exit(1);
}

const app = initializeApp({
  credential: cert({ projectId: PROJECT_ID, clientEmail: fbEmail, privateKey: fbKey }),
  projectId: PROJECT_ID,
});
const db = getFirestore(app);
db.settings({ databaseId: DB_ID });

const today = new Date().toISOString().slice(0, 10);
const baseDir = process.env.BACKUP_DIR || '/app/backups';
const outDir = join(baseDir, today);
mkdirSync(outDir, { recursive: true });

let totalDocs = 0;
for (const name of COLLECTIONS) {
  try {
    const snap = await db.collection(name).get();
    const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(docs, null, 1));
    totalDocs += docs.length;
    console.log(`${name}: ${docs.length} doküman`);
  } catch (e) {
    console.warn(`${name}: HATA — ${e.message}`);
  }
}

// Eski yedekleri temizle
try {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  for (const dir of readdirSync(baseDir)) {
    const t = Date.parse(dir);
    if (!Number.isNaN(t) && t < cutoff) {
      rmSync(join(baseDir, dir), { recursive: true, force: true });
      console.log(`Eski yedek silindi: ${dir}`);
    }
  }
} catch { /* temizleme kritik değil */ }

console.log(`✓ Yedek tamamlandı: ${outDir} — toplam ${totalDocs} doküman`);
process.exit(0);
