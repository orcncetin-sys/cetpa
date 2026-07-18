/**
 * backup-db-offsite.mjs — cetpa_db'nin tam pg_dump yedegini + sunucu diskindeki
 * uploads/ klasorunu (tahsilat makbuzlari vb.) alir, sunucuda zaten kurulu
 * Firebase Admin servis hesabiyla Firebase Storage'a yukler.
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
import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
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
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
const DB_PREFIX = 'db-backups/';
const UPLOADS_PREFIX = 'uploads-backups/';
const LOCAL_RETENTION_DAYS = 3;
const REMOTE_RETENTION_DAYS = 30;

mkdirSync(LOCAL_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ── Firebase Admin init (bir kere) ──────────────────────────────────────────
const fbEmail = process.env.FIREBASE_CLIENT_EMAIL;
const fbKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const credential = fbEmail && fbKey
  ? admin.credential.cert({ projectId: PROJECT_ID, clientEmail: fbEmail, privateKey: fbKey })
  : undefined;
admin.initializeApp({ credential, projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
const bucket = admin.storage().bucket();

// ── 1) PostgreSQL pg_dump ────────────────────────────────────────────────────
const dbFileName = `cetpa_db_${stamp}.dump`;
const dbLocalPath = join(LOCAL_DIR, dbFileName);
console.log(`pg_dump baslatiliyor -> ${dbLocalPath}`);
await execFileAsync(PG_DUMP, [DATABASE_URL, '-Fc', '-f', dbLocalPath]);
console.log('pg_dump tamamlandi, boyut:', (statSync(dbLocalPath).size / 1024 / 1024).toFixed(2), 'MB');
console.log(`Firebase Storage'a yukleniyor -> ${DB_PREFIX}${dbFileName}`);
// Off-site upload basarisiz olsa bile (or. Storage etkin degil / bucket yok)
// SCRIPT COKMEZ: yerel pg_dump zaten alindi ve asagidaki yerel-retention
// calismali (yoksa yerel yedekler birikip diski doldurur). Uploads bolumu
// zaten try/catch'liydi; DB upload'i ve uzak-retention'i da sardik.
let offsiteOk = true;
try {
  await bucket.upload(dbLocalPath, { destination: `${DB_PREFIX}${dbFileName}` });
  console.log('DB yedegi yuklendi.');
} catch (e) {
  offsiteOk = false;
  console.error('DB OFF-SITE upload BASARISIZ (yerel yedek guvende):', e?.message || e);
}

// ── 2) uploads/ klasoru (tahsilat makbuzlari vb.) → tar.gz ───────────────────
// Windows Server 2022'de bsdtar (System32\tar.exe) built-in gelir.
if (existsSync(UPLOAD_DIR) && readdirSync(UPLOAD_DIR).length > 0) {
  const upFileName = `cetpa_uploads_${stamp}.tar.gz`;
  const upLocalPath = join(LOCAL_DIR, upFileName);
  console.log(`uploads/ arsivleniyor -> ${upLocalPath}`);
  try {
    // -C parent + relatif klasor adi: arsivde "uploads/..." yolu korunur.
    await execFileAsync('tar', ['-czf', upLocalPath, '-C', dirname(UPLOAD_DIR), basename(UPLOAD_DIR)]);
    console.log('tar tamamlandi, boyut:', (statSync(upLocalPath).size / 1024 / 1024).toFixed(2), 'MB');
    console.log(`Firebase Storage'a yukleniyor -> ${UPLOADS_PREFIX}${upFileName}`);
    await bucket.upload(upLocalPath, { destination: `${UPLOADS_PREFIX}${upFileName}` });
    console.log('uploads yedegi yuklendi.');
  } catch (e) {
    // uploads yedegi basarisiz olsa bile DB yedegi zaten alindi — is'i cokertme.
    console.error('uploads yedegi ALINAMADI (DB yedegi guvende):', e?.message || e);
  }
} else {
  console.log('uploads/ bos veya yok — atlaniyor.');
}

// ── 3) Yerel retention (3 gun) — hem db hem uploads ──────────────────────────
const localCutoff = Date.now() - LOCAL_RETENTION_DAYS * 86400_000;
for (const f of readdirSync(LOCAL_DIR)) {
  const p = join(LOCAL_DIR, f);
  if ((f.startsWith('cetpa_db_') || f.startsWith('cetpa_uploads_')) && statSync(p).mtimeMs < localCutoff) {
    rmSync(p, { force: true });
    console.log('Yerel eski yedek silindi:', f);
  }
}

// ── 4) Uzak retention (30 gun) — her iki prefix icin ─────────────────────────
// Off-site erisilmiyorsa (Storage etkin degil) atla — script cokmesin.
if (offsiteOk) {
  try {
    const remoteCutoff = Date.now() - REMOTE_RETENTION_DAYS * 86400_000;
    for (const prefix of [DB_PREFIX, UPLOADS_PREFIX]) {
      const [files] = await bucket.getFiles({ prefix });
      for (const file of files) {
        const [meta] = await file.getMetadata();
        if (new Date(meta.timeCreated).getTime() < remoteCutoff) {
          await file.delete();
          console.log('Uzak eski yedek silindi:', file.name);
        }
      }
    }
  } catch (e) {
    console.error('Uzak retention atlandi (off-site erisilemiyor):', e?.message || e);
  }
}

// Off-site basarisizsa exit 1 ile bitir ki Task Scheduler/log fark etsin;
// ama yerel yedek + retention ZATEN yapildi (veri korundu).
if (!offsiteOk) {
  console.error('UYARI: off-site yedek alinamadi (yerel yedek tamam). Firebase Storage etkin mi?');
  process.exitCode = 1;
}
console.log('Yedekleme tamamlandi (yerel kesin; off-site: ' + (offsiteOk ? 'OK' : 'BASARISIZ') + ').');
