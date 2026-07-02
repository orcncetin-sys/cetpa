/**
 * backup-db-offsite.mjs — cetpa_db'nin tam pg_dump yedegini alir, sunucuda
 * zaten kurulu Firebase Admin servis hesabiyla Firebase Storage'a yukler.
 *
 * Windows Task Scheduler ile gunluk calistirilir (bkz. deploy/windows/register-backup-task.ps1):
 *   node scripts/backup-db-offsite.mjs
 * "Start in": C:\cetpa  (server.ts ile ayni sekilde .env'i cwd'den yukler)
 *
 * ODEA'nin (VDS saglayicisi) yanlislikla sunucuyu askiya almasi/kaybetmesi
 * senaryosuna karsi yedek BASKA BIR SAGLAYICIDA (Google Cloud/Firebase) durur.
 * Yerel kopya 3 gun, Storage kopyasi 30 gun saklanir.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

const execFileAsync = promisify(execFile);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik.'); process.exit(1); }

const PROJECT_ID = 'gen-lang-client-0628151245';
const STORAGE_BUCKET = 'gen-lang-client-0628151245.firebasestorage.app';
const PG_DUMP = process.env.PG_DUMP_PATH || 'pg_dump';
const LOCAL_DIR = process.env.BACKUP_DIR || 'C:\\cetpa\\backups';
const STORAGE_PREFIX = 'db-backups/';
const LOCAL_RETENTION_DAYS = 3;
const REMOTE_RETENTION_DAYS = 30;

mkdirSync(LOCAL_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const fileName = `cetpa_db_${stamp}.dump`;
const localPath = join(LOCAL_DIR, fileName);

console.log(`pg_dump baslatiliyor -> ${localPath}`);
await execFileAsync(PG_DUMP, [DATABASE_URL, '-Fc', '-f', localPath]);
console.log('pg_dump tamamlandi, boyut:', (statSync(localPath).size / 1024 / 1024).toFixed(2), 'MB');

const fbEmail = process.env.FIREBASE_CLIENT_EMAIL;
const fbKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const credential = fbEmail && fbKey
  ? admin.credential.cert({ projectId: PROJECT_ID, clientEmail: fbEmail, privateKey: fbKey })
  : undefined;
admin.initializeApp({ credential, projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });

const bucket = admin.storage().bucket();
const destination = `${STORAGE_PREFIX}${fileName}`;
console.log(`Firebase Storage'a yukleniyor -> ${destination}`);
await bucket.upload(localPath, { destination });
console.log('Yukleme tamamlandi.');

const localCutoff = Date.now() - LOCAL_RETENTION_DAYS * 86400_000;
for (const f of readdirSync(LOCAL_DIR)) {
  const p = join(LOCAL_DIR, f);
  if (f.startsWith('cetpa_db_') && statSync(p).mtimeMs < localCutoff) {
    rmSync(p, { force: true });
    console.log('Yerel eski yedek silindi:', f);
  }
}

const [files] = await bucket.getFiles({ prefix: STORAGE_PREFIX });
const remoteCutoff = Date.now() - REMOTE_RETENTION_DAYS * 86400_000;
for (const file of files) {
  const [meta] = await file.getMetadata();
  if (new Date(meta.timeCreated).getTime() < remoteCutoff) {
    await file.delete();
    console.log('Uzak eski yedek silindi:', file.name);
  }
}

console.log('Yedekleme tamamlandi.');
