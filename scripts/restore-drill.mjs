/**
 * restore-drill.mjs — "yedek alindi" ile "yedek CALISIYOR" arasindaki farki kapatir.
 *
 * NEDEN VAR (P0.3): bir yedegin diske/buluta yazilmis olmasi, ondan GERI
 * DONULEBILECEGINI kanitlamaz. Bozuk gzip, yarim yukleme, eksik satir ya da
 * yanlis kiraci filtresi ancak felaket aninda fark edilir — yani is islevden
 * cikinca. Bu script bunu ONCEDEN sinar.
 *
 * NE YAPAR
 *   1. Yedegi uzaktan (rclone) ya da yerelden alir
 *   2. gzip'i acar, NDJSON'u satir satir ayristirir  -> okunabilir mi?
 *   3. Koleksiyon bazinda satir sayar                -> icinde ne var?
 *   4. CANLI veritabaniyla KARSILASTIRIR             -> eksik satir var mi?
 *   5. Kiraci sizintisi kontrolu                     -> baska firmanin verisi var mi?
 *
 * 5. adim kritik: kiraci-bazli yedegin ANLAMI, icinde SADECE o firmanin
 * verisinin olmasi. Bir tek yabanci satir bile bulunursa yedek guvenli degil.
 *
 * CALISTIRMA (tsx sart):
 *   node --import tsx scripts/restore-drill.mjs --company <companyId>
 *   node --import tsx scripts/restore-drill.mjs --file C:\\yol\\yedek.ndjson.gz --company <id>
 *
 * Cikis kodu 0 = yedek saglam, 1 = SORUN VAR.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createReadStream, existsSync, mkdtempSync, rmSync } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { join } from 'path';
import { tmpdir } from 'os';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const execFileAsync = promisify(execFile);

const arg = (ad) => { const i = process.argv.indexOf(ad); return i > -1 ? process.argv[i + 1] : null; };
const companyId = arg('--company');
const dosyaArg = arg('--file');

if (!companyId) {
  console.error('Kullanim: node --import tsx scripts/restore-drill.mjs --company <companyId> [--file <yerel.ndjson.gz>]');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik.'); process.exit(1); }
const RCLONE = process.env.RCLONE_PATH || 'rclone';

const pool = new pg.Pool({ connectionString: DATABASE_URL });
let gecici = null;
let sorunVar = false;
const sorun = (m) => { console.error('  ✗ ' + m); sorunVar = true; };
const tamam  = (m) => console.log('  ✓ ' + m);

try {
  // ── 1) Yedek dosyasini bul ────────────────────────────────────────────────
  let yerelYol = dosyaArg;
  if (!yerelYol) {
    const { rows } = await pool.query(
      "SELECT data FROM docs WHERE coll = 'backupConfigs' AND data->>'companyId' = $1", [companyId]);
    const remote = rows[0]?.data?.rcloneRemote;
    if (!remote) {
      console.error(`[${companyId}] yedek hedefi tanimli degil — once kurulum yapin.`);
      process.exit(1);
    }
    const liste = JSON.parse(
      (await execFileAsync(RCLONE, ['lsjson', `${remote}/db-backups/`], { maxBuffer: 32e6 })).stdout || '[]');
    const enYeni = liste
      .filter(f => f.Name.endsWith('.ndjson.gz'))
      .sort((a, b) => new Date(b.ModTime) - new Date(a.ModTime))[0];
    if (!enYeni) { console.error(`[${companyId}] uzakta hic yedek YOK.`); process.exit(1); }

    gecici = mkdtempSync(join(tmpdir(), 'cetpa-drill-'));
    yerelYol = join(gecici, enYeni.Name);
    console.log(`En yeni yedek indiriliyor: ${enYeni.Name} (${(enYeni.Size / 1024).toFixed(0)} KB, ${enYeni.ModTime})`);
    await execFileAsync(RCLONE, ['copyto', `${remote}/db-backups/${enYeni.Name}`, yerelYol], { maxBuffer: 32e6 });
  }
  if (!existsSync(yerelYol)) { console.error('Dosya yok: ' + yerelYol); process.exit(1); }

  // ── 2-3) Ac, ayristir, say ────────────────────────────────────────────────
  console.log('\nYedek okunuyor...');
  const kolSayim = new Map();
  const yabanciKiraci = new Map();
  let toplam = 0, bozukSatir = 0;

  const rl = createInterface({
    input: createReadStream(yerelYol).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const satir of rl) {
    if (!satir.trim()) continue;
    toplam++;
    try {
      const k = JSON.parse(satir);
      kolSayim.set(k.coll, (kolSayim.get(k.coll) ?? 0) + 1);
      const cid = k?.data?.companyId;
      if (cid && cid !== companyId) yabanciKiraci.set(cid, (yabanciKiraci.get(cid) ?? 0) + 1);
    } catch { bozukSatir++; }
  }

  if (toplam === 0) sorun('yedek BOS — hic satir yok'); else tamam(`${toplam} satir okunabildi (gzip saglam)`);
  if (bozukSatir) sorun(`${bozukSatir} satir AYRISTIRILAMADI — dosya bozuk olabilir`);
  else if (toplam) tamam('tum satirlar gecerli JSON');

  // ── 4) Canli veritabaniyla tie-out ────────────────────────────────────────
  const { rows: [{ n: canli }] } = await pool.query(
    "SELECT count(*)::int AS n FROM docs WHERE data->>'companyId' = $1", [companyId]);
  const fark = canli - toplam;
  if (fark === 0) tamam(`canli veriyle BIREBIR ayni: ${canli} satir`);
  else if (fark > 0) sorun(`EKSIK: canlida ${canli}, yedekte ${toplam} (${fark} satir yedekte YOK)`);
  else console.log(`  ℹ yedekte ${-fark} satir FAZLA — yedek alindiktan sonra silinmis kayitlar olabilir (normal)`);

  // ── 5) Kiraci sizintisi ───────────────────────────────────────────────────
  if (yabanciKiraci.size === 0) tamam('yalniz bu firmanin verisi var (sizinti yok)');
  else {
    for (const [cid, n] of yabanciKiraci) sorun(`SIZINTI: ${cid} firmasinin ${n} satiri bu yedekte!`);
  }

  console.log('\nKoleksiyon dagilimi (ilk 12):');
  [...kolSayim.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(7)}  ${k}`));

  console.log(sorunVar
    ? '\nSONUC: YEDEK GUVENILIR DEGIL — yukaridaki sorunlar giderilmeden yedege guvenmeyin.'
    : '\nSONUC: yedek saglam, okunabilir, eksiksiz ve izole.');
} finally {
  if (gecici) rmSync(gecici, { recursive: true, force: true });
  await pool.end();
}
process.exit(sorunVar ? 1 : 0);
