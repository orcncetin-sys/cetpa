/**
 * backup-setup.mjs — bir kiracının yedek hedefini KAYDEDER.
 *
 * "Her yeni şirket kendi setup'ını gerektirsin" (2026-08-21) kararının eksik
 * parçasıydı: backup-tenants.mjs `backupConfigs` okuyor, bekçi kurulum
 * yapmamış kiracıyı arıza sayıyor — ama kurulumu YAPACAK bir araç yoktu.
 * Elle SQL yazmak, onboarding'i "yanlış yazarsan sessizce yedeksiz kalırsın"
 * haline getirirdi.
 *
 * KAYDETMEDEN ÖNCE SINAR. Bu bilinçli: kurulum adımının "başarılı" deyip
 * gerçekte çalışmaması, bu projede tekrar tekrar yaşanan hata sınıfının ta
 * kendisi (yedek aylarca sessizce alınmadı). Script gerçek bir dosya yazar,
 * geri okur, boyutunu doğrular ve siler; ancak o zaman kaydeder.
 *
 * KULLANIM
 *   node --import tsx scripts/backup-setup.mjs --company <id> --remote gdrive-cetpa:cetpa-backups
 *   node --import tsx scripts/backup-setup.mjs --list
 *   node --import tsx scripts/backup-setup.mjs --company <id> --disable
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const execFileAsync = promisify(execFile);
const RCLONE = process.env.RCLONE_PATH || 'rclone';

const arg = (a) => { const i = process.argv.indexOf(a); return i > -1 ? process.argv[i + 1] : null; };
const has = (a) => process.argv.includes(a);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: DATABASE_URL });

const companyId = arg('--company');
const remote = arg('--remote');

try {
  // ── Listeleme: hangi kiracı kurulu, hangisi değil ─────────────────────────
  if (has('--list') || (!companyId && !remote)) {
    const { rows: kiracilar } = await pool.query(
      "SELECT DISTINCT data->>'companyId' AS cid, count(*)::int AS n FROM docs " +
      "WHERE data ? 'companyId' AND data->>'companyId' <> '' GROUP BY 1 ORDER BY 2 DESC");
    const { rows: ayarlar } = await pool.query("SELECT data FROM docs WHERE coll = 'backupConfigs'");
    const map = new Map(ayarlar.map(r => [String(r.data.companyId ?? ''), r.data]));

    console.log('Kiraci                                    Satir   Yedek hedefi');
    console.log('-'.repeat(92));
    for (const { cid, n } of kiracilar) {
      const a = map.get(cid);
      const durum = !a ? 'KURULUM YOK'
        : a.enabled === false ? 'kapali'
        : `${a.rcloneRemote}${a.lastRunAt ? ` (son: ${String(a.lastRunAt).slice(0, 16)})` : ' (hic kosmadi)'}`;
      console.log(`${cid.padEnd(40)} ${String(n).padStart(7)}   ${durum}`);
    }
    console.log('\nKurulum: node --import tsx scripts/backup-setup.mjs --company <id> --remote <remote:klasor>');
    process.exit(0);
  }

  if (!companyId) { console.error('--company gerekli.'); process.exit(1); }

  // ── Kapatma ───────────────────────────────────────────────────────────────
  if (has('--disable')) {
    await pool.query(
      `UPDATE docs SET data = data || '{"enabled":false}'::jsonb
         WHERE coll = 'backupConfigs' AND data->>'companyId' = $1`, [companyId]);
    console.log(`[${companyId}] yedek KAPATILDI (bekci artik arizasi saymayacak).`);
    process.exit(0);
  }

  if (!remote || !remote.includes(':')) {
    console.error('--remote gerekli, "remote:klasor" bicimde olmali (or. gdrive-cetpa:cetpa-backups)');
    process.exit(1);
  }

  // ── SINA: gercekten yazip okuyabiliyor muyuz? ─────────────────────────────
  console.log(`[${companyId}] hedef sinaniyor: ${remote}`);
  const denemeAd = `.cetpa-setup-test-${randomUUID().slice(0, 8)}`;
  const denemeYol = `${remote}/${denemeAd}`;
  const icerik = `cetpa backup setup test ${new Date().toISOString()}`;
  try {
    await execFileAsync(RCLONE, ['rcat', denemeYol], { input: icerik });
    const cikti = await execFileAsync(RCLONE, ['lsjson', denemeYol]);
    const kayit = JSON.parse(cikti.stdout || '[]')[0];
    if (!kayit) throw new Error('yazildi ama geri okunamadi');
    if (Number(kayit.Size) !== Buffer.byteLength(icerik)) {
      throw new Error(`boyut uyusmuyor (yazilan ${Buffer.byteLength(icerik)} B, okunan ${kayit.Size} B)`);
    }
    console.log('  ✓ yazma + geri okuma + boyut dogrulamasi BASARILI');
  } catch (e) {
    console.error('  ✗ hedef KULLANILAMAZ: ' + (e?.message || e));
    console.error('    Kurulum KAYDEDILMEDI — calismayan bir hedefi kayitli gostermek,');
    console.error('    yedeklendigini sanan ama yedeklenmeyen musteri demektir.');
    process.exit(1);
  } finally {
    try { await execFileAsync(RCLONE, ['deletefile', denemeYol]); } catch { /* temizlik best-effort */ }
  }

  // ── KAYDET ────────────────────────────────────────────────────────────────
  const { rows: mevcut } = await pool.query(
    "SELECT id FROM docs WHERE coll = 'backupConfigs' AND data->>'companyId' = $1", [companyId]);
  const kayit = {
    companyId, rcloneRemote: remote, enabled: true,
    updatedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  };
  if (mevcut.length) {
    await pool.query("UPDATE docs SET data = data || $2::jsonb WHERE id = $1",
      [mevcut[0].id, JSON.stringify(kayit)]);
    console.log(`[${companyId}] yedek hedefi GUNCELLENDI -> ${remote}`);
  } else {
    await pool.query("INSERT INTO docs (coll, id, data) VALUES ('backupConfigs', $1, $2)",
      [randomUUID(), JSON.stringify({ ...kayit, createdAt: new Date().toISOString() })]);
    console.log(`[${companyId}] yedek hedefi KAYDEDILDI -> ${remote}`);
  }
  console.log('\nSimdi ilk yedegi alin:');
  console.log(`  node --import tsx scripts/backup-tenants.mjs --company ${companyId}`);
} finally {
  await pool.end();
}
