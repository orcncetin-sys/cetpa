/**
 * backup-tenants.mjs — HER KİRACIYI KENDİ hesabına yedekler.
 *
 * 2026-08-21 kararı: "her yeni şirket kendi setup'ını gerektirsin."
 * Önceki durum tek bir pg_dump'tı ve TÜM kiracıları birlikte alıyordu — çok
 * kiracılı bir SaaS'te kabul edilemez: bir müşteriye yedeğini vermek
 * diğerlerinin verisini de vermek olurdu.
 *
 * Her kiracı `backupConfigs` koleksiyonunda kendi rclone remote'unu tanımlar.
 * Kurulum yapılmamış kiracı SESSİZCE ATLANMAZ — sayılır ve raporlanır; aksi
 * halde "yedeklendiğini sanan ama yedeklenmeyen müşteri" ortaya çıkar.
 *
 * ÇALIŞTIRMA — `tsx` ŞART (düz `node` DEĞİL):
 *   node --import tsx scripts/backup-tenants.mjs
 *   node --import tsx scripts/backup-tenants.mjs --company <companyId>
 *
 * Sebep: planlama mantığı src/lib/tenantBackup.ts'te testli olarak duruyor
 * (tenantBackup.test.ts, 8 test) ve düz node .ts import edemez. Uygulamanın
 * kendisi de aynı şekilde koşuyor (NSSM: `node --import tsx server.ts`), tsx
 * normal bir bağımlılık — sunucuda zaten kurulu.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, mkdirSync, statSync, existsSync, readdirSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  yedekPlani, KIRACI_SORGUSU, ETIKETSIZ_SAYIM_SORGUSU,
} from '../src/lib/tenantBackup.js';

dotenv.config({ quiet: true });
const execFileAsync = promisify(execFile);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik.'); process.exit(1); }

const RCLONE = process.env.RCLONE_PATH || 'rclone';
const LOCAL_DIR = process.env.BACKUP_DIR || 'C:\\cetpa\\backups';
const UPLOAD_ROOT = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
const DB_PREFIX = 'db-backups/';
const UPLOADS_PREFIX = 'uploads-backups/';
const LOCAL_RETENTION_DAYS = 3;

const argCompany = (() => {
  const i = process.argv.indexOf('--company');
  return i > -1 ? process.argv[i + 1] : null;
})();

mkdirSync(LOCAL_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function rclone(args) {
  const { stdout } = await execFileAsync(RCLONE, args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

/** Yükle + DOĞRULA — "yükledim" demek yetmez, uzakta var mı ve boyutu tutuyor mu. */
async function yukleVeDogrula(yerelYol, remote, uzakYol) {
  const beklenen = statSync(yerelYol).size;
  await rclone(['copyto', yerelYol, `${remote}/${uzakYol}`]);
  const kayitlar = JSON.parse((await rclone(['lsjson', `${remote}/${uzakYol}`])) || '[]');
  const uzak = Array.isArray(kayitlar) ? kayitlar[0] : null;
  if (!uzak) throw new Error(`yukleme sonrasi dosya uzakta BULUNAMADI: ${uzakYol}`);
  if (Number(uzak.Size) !== beklenen) {
    throw new Error(`boyut UYUSMUYOR: yerel ${beklenen} B, uzak ${uzak.Size} B — yukleme yarim`);
  }
  return beklenen;
}

/** Kiracının satırlarını NDJSON.gz olarak yazar. Satır satır akıtılır (bellek şişmesin). */
async function kiraciExport(companyId, hedefYol) {
  const client = await pool.connect();
  let satir = 0;
  try {
    const { rows } = await client.query(KIRACI_SORGUSU, [companyId]);
    satir = rows.length;
    const kaynak = Readable.from(rows.map(r => JSON.stringify(r) + '\n'));
    await pipeline(kaynak, createGzip(), createWriteStream(hedefYol));
  } finally {
    client.release();
  }
  return satir;
}

// ── Ana akış ────────────────────────────────────────────────────────────────
const { rows: ayarlar } = await pool.query(
  argCompany
    ? "SELECT data FROM docs WHERE coll = 'backupConfigs' AND data->>'companyId' = $1"
    : "SELECT data FROM docs WHERE coll = 'backupConfigs'",
  argCompany ? [argCompany] : [],
);

// Kurulum yapmamış kiracıları da GÖRMEK zorundayız: yalnız backupConfigs'e
// bakmak, hiç kurulum yapmamış firmayı tamamen görünmez yapardı.
const { rows: tumKiracilar } = await pool.query(
  "SELECT DISTINCT data->>'companyId' AS cid FROM docs WHERE data ? 'companyId' AND data->>'companyId' <> ''",
);

const ayarMap = new Map(ayarlar.map(r => [r.data.companyId, r.data]));
const hedefKiracilar = argCompany
  ? [argCompany]
  : tumKiracilar.map(r => r.cid).filter(Boolean);

console.log(`Kiraci sayisi: ${hedefKiracilar.length}`);

const sonuc = { ok: [], hata: [], kurulumYok: [], devreDisi: [] };

for (const cid of hedefKiracilar) {
  const ayar = ayarMap.get(cid) || { companyId: cid };
  const karar = yedekPlani(ayar, stamp);

  if ('atla' in karar) {
    (karar.atla === 'kurulum-yok' ? sonuc.kurulumYok : sonuc.devreDisi).push(cid);
    console.warn(`  [${cid}] ATLANDI — ${karar.atla}`);
    continue;
  }

  const plan = karar.plan;
  const dbYerel = join(LOCAL_DIR, plan.dbDosyaAdi);
  try {
    const satir = await kiraciExport(cid, dbYerel);
    const bayt = await yukleVeDogrula(dbYerel, plan.remote, `${DB_PREFIX}${plan.dbDosyaAdi}`);
    console.log(`  [${cid}] DB: ${satir} satir, ${(bayt / 1024).toFixed(0)} KB — DOGRULANDI`);

    // Kiracının KENDİ uploads klasörü (uploads/tahsilat/<companyId>/ deseni)
    const upDir = join(UPLOAD_ROOT, 'tahsilat', cid);
    if (existsSync(upDir) && readdirSync(upDir).length > 0) {
      const upYerel = join(LOCAL_DIR, plan.uploadsDosyaAdi);
      await execFileAsync('tar', ['-czf', upYerel, '-C', dirname(upDir), basename(upDir)]);
      const ub = await yukleVeDogrula(upYerel, plan.remote, `${UPLOADS_PREFIX}${plan.uploadsDosyaAdi}`);
      console.log(`  [${cid}] uploads: ${(ub / 1024).toFixed(0)} KB — DOGRULANDI`);
    }

    await rclone(['delete', '--min-age', `${plan.retentionDays}d`, `${plan.remote}/${DB_PREFIX}`]);
    await rclone(['delete', '--min-age', `${plan.retentionDays}d`, `${plan.remote}/${UPLOADS_PREFIX}`]);

    await pool.query(
      `UPDATE docs SET data = data || $2::jsonb
         WHERE coll = 'backupConfigs' AND data->>'companyId' = $1`,
      [cid, JSON.stringify({ lastRunAt: new Date().toISOString(), lastStatus: 'ok', lastError: null, lastRows: satir, lastBytes: bayt })],
    );
    sonuc.ok.push(cid);
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(`  [${cid}] HATA: ${msg}`);
    await pool.query(
      `UPDATE docs SET data = data || $2::jsonb
         WHERE coll = 'backupConfigs' AND data->>'companyId' = $1`,
      [cid, JSON.stringify({ lastRunAt: new Date().toISOString(), lastStatus: 'error', lastError: msg.slice(0, 500) })],
    ).catch(() => {});
    sonuc.hata.push(cid);
  }
}

// ── Yerel retention ─────────────────────────────────────────────────────────
const cutoff = Date.now() - LOCAL_RETENTION_DAYS * 86400_000;
for (const f of readdirSync(LOCAL_DIR)) {
  const p = join(LOCAL_DIR, f);
  if (f.startsWith('cetpa_') && statSync(p).mtimeMs < cutoff) rmSync(p, { force: true });
}

// ── ETİKETSİZ satırlar: hiçbir kiracının yedeğine girmez ────────────────────
const { rows: [{ n: etiketsiz }] } = await pool.query(ETIKETSIZ_SAYIM_SORGUSU);
if (etiketsiz > 0) {
  console.warn(`UYARI: ${etiketsiz} satirin companyId'si YOK — hicbir kiraci yedegine girmedi.`);
  console.warn('  Bunlar kime ait belirsiz oldugu icin bilerek disarida birakildi (yanlis kiraciya sizmasin).');
}

console.log('\nOZET');
console.log(`  basarili   : ${sonuc.ok.length}`);
console.log(`  HATA       : ${sonuc.hata.length}${sonuc.hata.length ? ' -> ' + sonuc.hata.join(', ') : ''}`);
console.log(`  KURULUM YOK: ${sonuc.kurulumYok.length}${sonuc.kurulumYok.length ? ' -> ' + sonuc.kurulumYok.join(', ') : ''}`);
console.log(`  devre disi : ${sonuc.devreDisi.length}`);

await pool.end();
// Kurulum yapmamis kiraci VARSA da hata kodu don: bu bir eksiklik, sessiz kalmamali.
if (sonuc.hata.length || sonuc.kurulumYok.length) process.exitCode = 1;
