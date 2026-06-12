/**
 * backup-db.mjs — PostgreSQL docs tablosunu koleksiyon başına JSON'a yedekler.
 * (backup-firestore.mjs'in PostgreSQL sonrası halefi — aynı çıktı formatı.)
 *
 * Container içinden çalışır:
 *   docker exec cetpa-app node scripts/backup-db.mjs
 *
 * Çıktı: /app/backups/YYYY-MM-DD/<koleksiyon>.json  ([{_id, ...data}, ...])
 * 7 günden eski yedekleri siler.
 */
import pg from 'pg';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';

const RETENTION_DAYS = 7;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

const today = new Date().toISOString().slice(0, 10);
const baseDir = process.env.BACKUP_DIR || '/app/backups';
const outDir = join(baseDir, today);
mkdirSync(outDir, { recursive: true });

const { rows: colls } = await pool.query('SELECT DISTINCT coll FROM docs ORDER BY coll');
let totalDocs = 0;
for (const { coll } of colls) {
  const { rows } = await pool.query('SELECT id, data FROM docs WHERE coll = $1', [coll]);
  const docs = rows.map(r => ({ _id: r.id, ...r.data }));
  writeFileSync(join(outDir, `${coll}.json`), JSON.stringify(docs, null, 1));
  totalDocs += docs.length;
  console.log(`${coll}: ${docs.length} doküman`);
}
console.log(`Toplam ${totalDocs} doküman → ${outDir}`);

// Eski yedekleri temizle
const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString().slice(0, 10);
for (const dir of readdirSync(baseDir)) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dir) && dir < cutoff) {
    rmSync(join(baseDir, dir), { recursive: true, force: true });
    console.log(`Eski yedek silindi: ${dir}`);
  }
}
await pool.end();
