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
  'wmsLocations', 'dataRequests', 'vehicles', 'vehiclePositions', 'locationStocks', 'bankReportPresets',
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
  'urunAgaclari',
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
  // Ayni Mikro ayna ailesinin atlanmis iki uyesi (2026-08-25 kod incelemesi).
  // Kardeslerinin (mikroDepolar/mikroBankalar/mikroKasalar) hepsi listedeydi,
  // bu ikisi degildi -> filtresiz, yani her kiraci digerinin barkodlarini ve
  // odeme planlarini okuyabiliyordu. Ikisi de /api/mikro/import/{barkod,
  // odeme-plan} ile yaziliyor.
  'barkodlar', 'odemePlanlari',
  // ── 2026-08-25 denetimi: sinifi HIC olmayan iki is koleksiyonu ──
  // Ikisi de "filtresiz" dalina dusuyordu (tenantWhere WHERE eki eklemiyor,
  // rowVisible sonunda `true` donuyor) — yani her kiraci digerlerininkini
  // okuyabiliyordu. Ikisi de ZATEN companyId yaziyordu; eksik olan tek sey
  // bu kayitti. Kardes koleksiyon 'supplierConsignments' (GELEN mal) listedeydi,
  // 'consignments' (GIDEN konsinye: musteri adi + urun + miktar) atlanmisti.
  'consignments',
  // subscriptions: doc id = kullanicinin uid'i. ADMIN_ONLY oldugu icin yalniz
  // Admin/Manager okur, ama kiraci filtresi YOKTU: bir firmanin Admin'i
  // GET /api/db/subscriptions ile TUM firmalarin abonelik/plan kaydini
  // listeleyebiliyordu.
  'subscriptions',
  // companies: firma profili (unvan/sektor/buyukluk), doc id = kurucunun uid'i.
  // App.tsx:1128 onboarding'de yazar. Sinifsiz oldugu icin her kiraci
  // digerlerinin firma bilgisini okuyabiliyordu.
  'companies',
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
  // Cerezsiz trafik sayaci (2026-08-28) - gunluk toplamlar, kisisel veri yok.
  // Istemci /api/db'den okuyamaz; super-admin GET /api/trafik/ozet ile okur.
  'trafikGunluk',
  // ── 2026-08-25: SaaS platform verisi — istemcide HIC kullanilmiyor ──
  // Ucu de yalniz super-admin rotalarinca `adminDb` ile yaziliyor (adminDb
  // /api/db'yi ve RBAC'i baypas eder), ama koleksiyonlar /api/db'ye ACIKTI ve
  // hicbir kiraci filtresi yoktu. Olculdu: src/ altinda (server haric) sifir
  // kullanim, yani kapatmak hicbir ekrani kirmaz.
  //   tenantInvoices — iyzicoToken + odeme sayfasi linki + tutar + musteri
  //     e-postasi tasir; ADMIN_ONLY'de DE degildi, yani zero-trust yedegiyle
  //     HERHANGI bir personel rolu (Sales, HR...) tum kiracilarin odeme
  //     linklerini okuyabiliyordu.
  //   companyStatus — kiraci askiya alma durumu.
  //   invites — davet JETONU (bearer benzeri sir) + davetli e-postasi.
  //     Yalniz server.ts:3768/3798 ve superadminRoutes.ts:364 yazar,
  //     /api/invites/redeem okur; hepsi adminDb uzerinden.
  'tenantInvoices', 'companyStatus', 'invites',
];

/**
 * BILEREK SINIFSIZ birakilanlar (2026-08-25 denetiminde tek tek gecildi).
 *
 * Bu dosyanin basligi "sinifsiz koleksiyon her kiraciya aciktir; bu bilincli
 * bir secim olmali, kaza olmamali" diyor — ama o ana kadar bilinclileri
 * kazalardan ayiran bir KAYIT yoktu, dolayisiyla her denetimde ayni adaylar
 * bastan inceleniyordu. Liste artik burada:
 *
 *   users, settings   — platform verisi; kendi sahiplik/maskeleme mantiklari
 *                       var (ownsDoc, pinProtectedUserFields, redactSettings).
 *   paymentHistory    — ADMIN_ONLY; odeme kaydi.
 *   demoRequests,
 *   partnerApplications — PUBLIC_WRITE: kimliksiz halka acik formlar.
 *   testimonials      — pazarlama icerigi. GIRIS ONCESI acilis sayfasindan
 *                       okunur (LandingPage.tsx:1129), yani kiraci kavrami
 *                       yok; TENANT yapmak acilis sayfasini kirardi.
 */
export const DELIBERATELY_UNSCOPED_COLLECTIONS: readonly string[] = [
  'users', 'settings', 'paymentHistory', 'demoRequests', 'partnerApplications', 'testimonials',
];
