/**
 * backfill-tenant-companyid.ts — TENANT koleksiyonlarındaki ETİKETSİZ (companyId'siz)
 * dokümanlara companyId damgalar, ayrıca yanlış damgalanmış auditLog satırlarını onarır.
 *
 * Sunucu tarafı sahiplik/SSE filtresi "etiketsiz doc → herkese görünür" (lenient)
 * davrandığı için, İKİNCİ müşteri eklemeden ÖNCE mevcut tek tenant'ın verisi
 * damgalanmalı; aksi halde yeni tenant eski verileri görür.
 *
 * Çalıştırma (sunucuda, C:\cetpa içinden):
 *   npx tsx scripts/backfill-tenant-companyid.ts              # tek tenant'ı otomatik bul
 *   npx tsx scripts/backfill-tenant-companyid.ts <companyId>  # açıkça belirt
 *   DRY_RUN=1 npx tsx scripts/backfill-tenant-companyid.ts    # sadece raporla
 *
 * .mjs → .ts dönüşümü (2026-07-30): koleksiyon listesi burada ELLE kopyalanıyordu
 * ve kaymıştı — 2026-07 boyunca eklenen ~40 koleksiyon bu scriptte yoktu, yani
 * onların eski satırları hiç damgalanmadı. Artık src/lib/collections.ts'ten okur.
 *
 * Idempotent: yalnız companyId alanı OLMAYAN satırları günceller.
 */
import pg from 'pg';
import { TENANT_COLLECTIONS } from '../src/lib/collections.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik.'); process.exit(1); }
const DRY_RUN = process.env.DRY_RUN === '1';
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

async function resolveCompanyId(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  // users tablosundan farklı companyId'leri (yoksa uid) topla.
  const { rows } = await pool.query("SELECT DISTINCT COALESCE(data->>'companyId', id) AS cid FROM docs WHERE coll = 'users'");
  const cids = rows.map((r: { cid: string }) => r.cid).filter(Boolean);
  if (cids.length === 1) return cids[0];
  console.error(`Birden fazla (veya hiç) tenant bulundu: ${JSON.stringify(cids)}. companyId'yi argüman olarak verin.`);
  process.exit(1);
}

/**
 * auditLog onarımı: writeAuditLog 2026-07-30'a kadar `companyId: actor.uid`
 * yazıyordu — kullanıcının uid'i, ait olduğu FİRMANIN id'si değil. Tek-kullanıcılı
 * hesapta ikisi aynı olduğu için fark edilmiyordu; bir firmaya bağlı çalışanın
 * ürettiği satırlar yanlış damgalanmış oluyor. auditLog artık TENANT filtresine
 * girdiği için bu satırlar onarılmazsa firmanın denetim görünümünden DÜŞER.
 *
 * Onarım: satırdaki companyId bir users/{uid} dokümanının ID'siyse ve o kullanıcının
 * gerçek companyId'si farklıysa, gerçek değerle değiştir.
 */
async function repairAuditLogCompanyIds(): Promise<number> {
  const { rows } = await pool.query(`
    SELECT u.id AS uid, u.data->>'companyId' AS real_cid
    FROM docs u
    WHERE u.coll = 'users'
      AND u.data->>'companyId' IS NOT NULL
      AND u.data->>'companyId' <> u.id
  `);
  let fixed = 0;
  for (const r of rows as Array<{ uid: string; real_cid: string }>) {
    const countRes = await pool.query(
      "SELECT COUNT(*)::int AS n FROM docs WHERE coll = 'auditLog' AND data->>'companyId' = $1", [r.uid],
    );
    const n = countRes.rows[0].n as number;
    if (!n) continue;
    if (DRY_RUN) { console.log(`  [dry] auditLog: ${n} satır ${r.uid} → ${r.real_cid}`); fixed += n; continue; }
    const upd = await pool.query(
      "UPDATE docs SET data = jsonb_set(data, '{companyId}', to_jsonb($2::text)), updated_at = now() WHERE coll = 'auditLog' AND data->>'companyId' = $1",
      [r.uid, r.real_cid],
    );
    console.log(`  auditLog: ${upd.rowCount} satır ${r.uid} → ${r.real_cid}`);
    fixed += upd.rowCount ?? 0;
  }
  return fixed;
}

(async () => {
  const cid = await resolveCompanyId(process.argv[2]);
  console.log(`Hedef companyId: ${cid}${DRY_RUN ? '  (DRY_RUN)' : ''}`);
  console.log(`${TENANT_COLLECTIONS.length} TENANT koleksiyonu taranıyor...\n`);
  let totalUpdated = 0;
  for (const coll of TENANT_COLLECTIONS) {
    const countRes = await pool.query(
      "SELECT COUNT(*)::int AS n FROM docs WHERE coll = $1 AND NOT (data ? 'companyId')", [coll],
    );
    const n = countRes.rows[0].n as number;
    if (!n) continue;
    if (DRY_RUN) { console.log(`  [dry] ${coll}: ${n} etiketsiz doc damgalanacak`); totalUpdated += n; continue; }
    const upd = await pool.query(
      "UPDATE docs SET data = jsonb_set(data, '{companyId}', to_jsonb($2::text)), updated_at = now() WHERE coll = $1 AND NOT (data ? 'companyId')",
      [coll, cid],
    );
    console.log(`  ${coll}: ${upd.rowCount} doc damgalandı`);
    totalUpdated += upd.rowCount ?? 0;
  }
  console.log('\nauditLog companyId onarımı (uid → gerçek firma):');
  const repaired = await repairAuditLogCompanyIds();
  if (!repaired) console.log('  onarılacak satır yok');

  console.log(`\nToplam ${totalUpdated} doc ${DRY_RUN ? 'damgalanacak' : 'damgalandı'}, ${repaired} auditLog satırı ${DRY_RUN ? 'onarılacak' : 'onarıldı'}.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
