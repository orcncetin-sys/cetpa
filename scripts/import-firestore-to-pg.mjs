/**
 * import-firestore-to-pg.mjs — Firestore → PostgreSQL tek seferlik veri göçü.
 *
 * Container içinden çalışır (firebase-admin + pg + env creds hazır):
 *   docker exec cetpa-app node scripts/import-firestore-to-pg.mjs
 *
 * Strateji:
 *  1. Önce canlı Firestore'dan TÜM koleksiyonları çekmeyi dener
 *     (listCollections — yedekte olmayan koleksiyonları da kapsar).
 *  2. Kota/erişim hatasında /app/backups/<en-yeni-tarih>/ JSON'larına düşer.
 *
 * Hedef: DATABASE_URL'deki `docs` tablosuna (coll, id, data jsonb) upsert.
 * Idempotent — tekrar çalıştırmak güvenlidir (upsert).
 *
 * Bayraklar:
 *   --backup-only   Firestore'u hiç deneme, doğrudan yedekten yükle
 *   --dry-run       Yazma yapma, sadece sayıları raporla
 */
import admin from 'firebase-admin';
import pg from 'pg';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_ID = 'gen-lang-client-0628151245';
const DB_ID = 'ai-studio-d243947a-133d-4934-af2e-eff3bb6aeea7';

const BACKUP_ONLY = process.argv.includes('--backup-only');
const DRY_RUN = process.argv.includes('--dry-run');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

await pool.query(`CREATE TABLE IF NOT EXISTS docs (
  coll text NOT NULL,
  id   text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coll, id)
)`);

async function upsertDocs(coll, docs) {
  if (DRY_RUN) { console.log(`[dry-run] ${coll}: ${docs.length} doküman`); return docs.length; }
  let n = 0;
  for (const d of docs) {
    const { _id, ...data } = d;
    if (!_id) continue;
    await pool.query(
      `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [coll, _id, JSON.stringify(data)],
    );
    n++;
  }
  console.log(`${coll}: ${n} doküman yüklendi`);
  return n;
}

// JSON.stringify on admin-SDK docs turns Timestamps into {_seconds,_nanoseconds}
// (same shape the nightly backup produces) — the client shim revives these.
function serializeDoc(d) {
  return JSON.parse(JSON.stringify({ _id: d.id, ...d.data() }));
}

async function tryFirestore() {
  const fbEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const fbKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!fbEmail || !fbKey) throw new Error('FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY eksik.');
  const app = admin.initializeApp({
    credential: admin.credential.cert({ projectId: PROJECT_ID, clientEmail: fbEmail, privateKey: fbKey }),
    projectId: PROJECT_ID,
  });
  const db = app.firestore();
  db.settings({ databaseId: DB_ID });

  const collections = await db.listCollections();
  console.log(`Firestore: ${collections.length} koleksiyon bulundu`);
  let total = 0;
  for (const collRef of collections) {
    const snap = await collRef.get();
    total += await upsertDocs(collRef.id, snap.docs.map(serializeDoc));
  }
  return total;
}

function latestBackupDir() {
  const base = process.env.BACKUP_DIR || '/app/backups';
  if (!existsSync(base)) throw new Error(`Yedek dizini yok: ${base}`);
  const dates = readdirSync(base).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!dates.length) throw new Error(`Yedek bulunamadı: ${base}`);
  return join(base, dates[dates.length - 1]);
}

async function fromBackup() {
  const dir = latestBackupDir();
  console.log(`Yedekten yükleniyor: ${dir}`);
  let total = 0;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const coll = file.replace(/\.json$/, '');
    const docs = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    total += await upsertDocs(coll, docs);
  }
  return total;
}

let total = 0;
if (BACKUP_ONLY) {
  total = await fromBackup();
} else {
  try {
    total = await tryFirestore();
  } catch (e) {
    console.warn(`Firestore okunamadı (${e.message}) — yedeğe düşülüyor.`);
    total = await fromBackup();
  }
}

const { rows } = await pool.query('SELECT coll, count(*) FROM docs GROUP BY coll ORDER BY coll');
console.log('\nPostgreSQL docs tablosu:');
for (const r of rows) console.log(`  ${r.coll}: ${r.count}`);
console.log(`\nToplam ${total} doküman aktarıldı. ✓`);
await pool.end();
process.exit(0);
