/**
 * backfill-tenant-companyid.mjs — TENANT koleksiyonlarındaki ETİKETSİZ (companyId'siz)
 * dokümanlara companyId damgalar. 2026-06-22 çok-kiracılı izolasyon düzeltmesinin
 * parçası: server tarafı sahiplik/SSE filtresi "etiketsiz doc → herkese görünür"
 * (lenient) davrandığı için, İKİNCİ müşteri eklemeden ÖNCE mevcut tek tenant'ın
 * verisi damgalanmalı; aksi halde yeni tenant eski verileri görür.
 *
 * Container içinden çalıştır:
 *   docker exec cetpa-app node scripts/backfill-tenant-companyid.mjs            # tek tenant'ı otomatik bul
 *   docker exec cetpa-app node scripts/backfill-tenant-companyid.mjs <companyId>  # açıkça belirt
 *   docker exec -e DRY_RUN=1 cetpa-app node scripts/backfill-tenant-companyid.mjs # sadece raporla
 *
 * Idempotent: yalnız companyId alanı OLMAYAN satırları günceller.
 */
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik.'); process.exit(1); }
const DRY_RUN = process.env.DRY_RUN === '1';
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

// server.ts TENANT_COLLECTIONS ile elle senkron tutulur.
const TENANT_COLLECTIONS = [
  'inventory','leads','orders','quotations','shipments','warehouseItems','warehouses','employees',
  'customerRisks','inventoryMovements','priceLists','priceOverrides','suppliers','purchaseOrders',
  'returns','recurringOrders','recurringBilling','revenueContracts','contracts','supportTickets',
  'demandRequests','productionOrders','projectCosts','projectTimelines','capacityLines','letterOfCredit',
  'intercompanyTxns','approvalRequests','payrolls','leaveRequests','warranties','workflowTasks','categories',
  'commissionRules','subeler','vergiTakvimi','mikroFaturalar','transfers','checks','budgets','waybills',
  'services','accountingPeriods','taxSummary','wmsLocations','dataRequests',
  'akreditifler','amortismanKayitlari','arizalar','assemblyMeetings','auditItems','bankAccounts',
  'bankTransactions','boardMeetings','bom','campaigns','cargoTracking','complaints','complianceItems',
  'cpqQuotes','cpqTemplates','ctpatRecords','documentTemplates','dunningInvoices','dunningPolicies',
  'eBelgeler','eightDRecords','ekipmanlar','fiveSRecords','fmeaRecords','garantiler','gumrukBeyannameleri',
  'holdingAccounts','holdingEntities','holdingIntercompany','ihracatlar','invoices','isEmirleri','ithalatlar',
  'jobs','journalEntries','kaizenRecords','kasaHareketleri','kasaKapanislar','kasalar','legalCases','legalDocs',
  'lotHareketleri','lotKayitlari','machines','maliyetKalemleri','maliyetMerkezleri','masraflar','orderReturns',
  'payments','payrollEntries','performanceReviews','pfmeaRecords','projects','qcRecords','resources',
  'revenueSchedules','rmaRequests','routingTemplates','sabitKiymetBakim','sabitKiymetSigorta','sabitKiymetler',
  'seriNolar','servisTalepleri','shareholders','skuMappings','subeTransferler','tahsilatKayitlari',
  'tahsilatOdemeleri','tasks','taxDeclarations','teknisyenler','territories','timeAttendance','trainings',
  'travelRequests','warehouseBins','webhookConfigs','wmsCycleCounts','wmsTasks','workCenters',
  'dynamicsSyncLog','logoSyncLog','lucaSyncLog','sapSyncLog','syncLog',
];

async function resolveCompanyId(explicit) {
  if (explicit) return explicit;
  // users tablosundan farklı companyId'leri (yoksa uid) topla.
  const { rows } = await pool.query("SELECT DISTINCT COALESCE(data->>'companyId', id) AS cid FROM docs WHERE coll = 'users'");
  const cids = rows.map(r => r.cid).filter(Boolean);
  if (cids.length === 1) return cids[0];
  console.error(`Birden fazla (veya hiç) tenant bulundu: ${JSON.stringify(cids)}. companyId'yi argüman olarak verin.`);
  process.exit(1);
}

(async () => {
  const cid = await resolveCompanyId(process.argv[2]);
  console.log(`Hedef companyId: ${cid}${DRY_RUN ? '  (DRY_RUN)' : ''}`);
  let totalUpdated = 0;
  for (const coll of TENANT_COLLECTIONS) {
    const countRes = await pool.query(
      "SELECT COUNT(*)::int AS n FROM docs WHERE coll = $1 AND NOT (data ? 'companyId')", [coll],
    );
    const n = countRes.rows[0].n;
    if (!n) continue;
    if (DRY_RUN) { console.log(`  [dry] ${coll}: ${n} etiketsiz doc damgalanacak`); totalUpdated += n; continue; }
    const upd = await pool.query(
      "UPDATE docs SET data = jsonb_set(data, '{companyId}', to_jsonb($2::text)), updated_at = now() WHERE coll = $1 AND NOT (data ? 'companyId')",
      [coll, cid],
    );
    console.log(`  ${coll}: ${upd.rowCount} doc damgalandı`);
    totalUpdated += upd.rowCount;
  }
  console.log(`\nToplam ${totalUpdated} doc ${DRY_RUN ? 'damgalanacak' : 'damgalandı'}.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
