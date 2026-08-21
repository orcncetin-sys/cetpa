/**
 * collections.ts — Koleksiyon görünürlük sınıflandırmasının TEK KAYNAĞI.
 *
 * Hem `server.ts` (çalışma zamanı izolasyonu) hem `scripts/backfill-tenant-companyid.ts`
 * (geriye dönük damgalama) buradan okur. Daha önce liste iki yerde elle
 * kopyalanıyordu ve KAYMIŞTI: 2026-07 boyunca eklenen ~40 koleksiyon backfill
 * scriptine hiç işlenmemişti, yani o koleksiyonların eski satırları etiketsiz
 * kaldı. Yeni koleksiyon eklerken YALNIZ bu dosyayı düzenle.
 *
 * Sınıflar:
 *  - TENANT     → `companyId` ile izole. Etiketsiz eski satır lenient kuralla
 *                 görünür kalır; bu yüzden backfill scripti şart.
 *  - USER_SCOPED→ `userId` ile izole (kullanıcının kendi verisi).
 *  - SERVER_ONLY→ /api/db ve SSE'ye TAMAMEN kapalı. Yalnız sunucu yazar/okur.
 *
 * Hiçbirinde OLMAYAN koleksiyon FİLTRESİZDİR — her kiracıya açıktır. Bu bilinçli
 * bir seçim olmalı (settings, users, subscriptions gibi platform verisi), kaza
 * olmamalı. Kaza olduğunda ne oluyor: 2026-07-30 denetimi cariBalances /
 * stockDiscrepancies / syncJobs / auditLog'u tam bu durumda buldu.
 */

/** İş verisi — `companyId` ile kiracı bazında izole edilir. */
export const TENANT_COLLECTIONS: readonly string[] = [
  // ── Çekirdek satış/stok/lojistik ──
  'inventory', 'leads', 'orders', 'quotations', 'shipments', 'warehouseItems',
  'warehouses', 'employees', 'customerRisks', 'inventoryMovements', 'priceLists',
  'priceOverrides', 'suppliers', 'purchaseOrders', 'returns', 'recurringOrders',
  'recurringBilling', 'revenueContracts', 'contracts', 'supportTickets',
  'demandRequests', 'productionOrders', 'projectCosts', 'projectTimelines',
  'capacityLines', 'letterOfCredit', 'intercompanyTxns', 'approvalRequests',
  'payrolls', 'leaveRequests', 'warranties', 'workflowTasks', 'categories',
  'commissionRules', 'subeler', 'vergiTakvimi', 'mikroFaturalar', 'mikroCariHareketler',
  // 2026-08-18: 'mikroSiparisler' ve 'stockCounts' BU LISTEDE DEGILDI —
  // capraz-kiraci sizintisi. Her ikisi de companyId ile DOGRU yaziliyordu
  // (mikroSiparisler'i makeMikroSqlImport, stockCounts'u istemci), ama liste
  // disinda kaldiklari icin OKURKEN hic filtrelenmiyorlardi: B kiracisinin
  // istemcisi A kiracisinin Mikro siparislerini ve sayim kayitlarini
  // gorebiliyordu. Kardes koleksiyonlar (mikroFaturalar, mikroCariHareketler)
  // listedeydi, bu ikisi atlanmisti.
  // Ikinci fayda: injectTenant artik companyId'yi SUNUCUDA zorla dogrusuyla
  // damgaliyor — stockCounts istemcide `companyId: user?.uid` yaziyordu ve
  // davetle baska kiraciya katilmis kullanicida bu deger YANLIS oluyordu.
  'mikroSiparisler', 'stockCounts',
  // Her kiracinin KENDI yedek hedefi (2026-08-21 karari: "her sirket kendi
  // hesabina yedeklesin"). Kiracı-bazli olmak ZORUNDA — A firmasinin yedek
  // ayari B firmasina gorunmemeli. Icerdigi rclone remote ADI sir degildir
  // (jeton sunucudaki rclone.conf'ta durur) ama yine de Admin-only.
  'backupConfigs', 'mikroFiyatListeleri', 'mikroDemirbaslar', 'mikroMaliyetMerkezleri', 'transfers',
  'checks', 'budgets', 'waybills', 'services', 'accountingPeriods', 'taxSummary',
  'productionMetrics', // Phase 615 üretim kalite metrikleri (yerelden kalıcıya, 2026-07-21)
  // Demo→kalıcı göçü batch 2 (2026-07-21): satın alma bütçe/risk, tedarikçi
  // konsinyesi (giden 'consignments'tan FARKLI — gelen mal), kampanya metrikleri
  'purchaseBudgets', 'supplierRisks', 'supplierRatings', 'reportTargets', 'supplierConsignments', 'campaignMetrics',
  'autoInvoiceSchedules', // p591 Oto.Fatura (p640'ın recurringBilling'inden ayrı — şema farklı)
  // Batch 3 (2026-07-21): Siparişler yerel tabloları — mevcut gerçek akışlardan
  // (rmaRequests/orderReturns, supportTickets, ihracatlar) BİLEREK ayrı şemalar
  'salesReturns', 'serviceRequests', 'helpdeskTickets', 'exportShipments',
  'rfqQuotes', 'stockBatches', 'pricingRules', 'qualityChecklist',
  // Batch 4 (2026-07-21): koşu-anlık-görüntüsü + oturum kalıcılığı
  'payrollRuns', 'bankMatchRuns', 'revExpBudgets', 'stockCountSessions',
  'wmsLocations', 'dataRequests', 'vehicles', 'locationStocks', 'bankReportPresets',
  // ── 2026-06-22 review: eksik tenant-private iş koleksiyonları eklendi ──
  'akreditifler', 'amortismanKayitlari', 'arizalar', 'assemblyMeetings', 'auditItems',
  'bankAccounts', 'bankTransactions', 'boardMeetings', 'bom', 'campaigns', 'cargoTracking',
  'complaints', 'complianceItems', 'cpqQuotes', 'cpqTemplates', 'ctpatRecords',
  'documentTemplates', 'dunningInvoices', 'dunningPolicies', 'eBelgeler', 'eightDRecords',
  'ekipmanlar', 'fiveSRecords', 'fmeaRecords', 'garantiler', 'gumrukBeyannameleri',
  'holdingAccounts', 'holdingEntities', 'holdingIntercompany', 'ihracatlar', 'invoices',
  'isEmirleri', 'ithalatlar', 'jobs', 'journalEntries', 'kaizenRecords', 'kasaHareketleri',
  'kasaKapanislar', 'kasalar', 'legalCases', 'legalDocs', 'lotHareketleri', 'lotKayitlari',
  'machines', 'maliyetKalemleri', 'maliyetMerkezleri', 'masraflar', 'orderReturns',
  'payments', 'payrollEntries', 'performanceReviews', 'pfmeaRecords', 'projects',
  'qcRecords', 'resources', 'revenueSchedules', 'rmaRequests', 'routingTemplates',
  'sabitKiymetBakim', 'sabitKiymetSigorta', 'sabitKiymetler', 'seriNolar', 'servisTalepleri',
  'shareholders', 'skuMappings', 'subeTransferler', 'tahsilatKayitlari', 'tahsilatOdemeleri',
  'tasks', 'taxDeclarations', 'teknisyenler', 'territories', 'timeAttendance', 'trainings',
  'travelRequests', 'warehouseBins', 'webhookConfigs', 'wmsCycleCounts', 'wmsTasks', 'workCenters',
  // Entegrasyon senkron logları (firma-bazlı)
  'dynamicsSyncLog', 'logoSyncLog', 'lucaSyncLog', 'sapSyncLog', 'syncLog',
  // İstemci hata logu — append-only; firma-bazlı okuma izolasyonu (PII/stack sızıntısı)
  'clientErrors',
  // ── 2026-07-30 mimari denetimi: filtre DIŞINDA kalmış iş koleksiyonları ──
  // Hepsi zaten companyId yazıyordu; eksik olan tek şey bu kayıttı.
  'cariBalances',        // müşteri bakiyeleri — rakip kiracıya açıktı
  'stockDiscrepancies',  // sayım farkları (istemci zaten companyId ile sorguluyor)
  'syncJobs',            // istemci-yazımlı retry kuyruğu (injectTenant artık damgalar)
  'auditLog',            // denetim kaydı — actor e-postası + alan diff'leri taşır
  // Mikro ham veri aynaları (2026-07-31). Kirli/ham satırlar tipli UI
  // koleksiyonlarını kirletmesin diye ayrı tutulur; temiz doküman postProcess
  // ile ilgili UI koleksiyonuna yazılır.
  'mikroDepolar', 'mikroBankalar', 'mikroKasalar',
];

/** Kullanıcının kendi verisi — `userId` ile izole. */
export const USER_SCOPED_COLLECTIONS: readonly string[] = [
  'notifications', 'userPrefs', 'userOnboarding', 'aiConsents',
];

/**
 * Yalnız sunucunun yazıp okuduğu koleksiyonlar — /api/db'den ve SSE stream'den
 * TAMAMEN kapalı. Okuma gerekiyorsa süper-admin'e özel bir uç yazılır
 * (örn. opsChecks → GET /api/ops/watchdog).
 *
 * PII taşıyan gönderim logları (alıcı e-postası / telefon / mesaj metni) TENANT
 * yerine buraya konur: ileride bir ekran gerekirse 403 ile GÜRÜLTÜLÜ patlar ve
 * o zaman alanı kırpılmış özel bir uç yazılır — sessizce sızmaz.
 */
export const SERVER_ONLY_COLLECTIONS: readonly string[] = [
  'opsChecks', 'emailLog', 'whatsappMessages', 'waMessageLog',
];
