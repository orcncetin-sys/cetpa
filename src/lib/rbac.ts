/**
 * rbac.ts — Sunucu tarafı rol bazlı erişim politikası (saf fonksiyonlar).
 *
 * server.ts bu modülü import eder; rol DB'den okunup buraya parametre olarak
 * geçilir. DB/IO içermez → birim testle kilitlenebilir (rbac.test.ts).
 */

export type AppRole = 'Admin' | 'Manager' | 'Sales' | 'Logistics' | 'Accounting'
  | 'HR' | 'Purchasing' | 'B2B' | 'Dealer' | 'Legal' | 'Corporate' | 'Quality';

export type DbOp = 'read' | 'write' | 'delete';

export const ADMIN_ROLES: AppRole[] = ['Admin', 'Manager'];
export const STAFF_ROLES: AppRole[] = ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'Legal', 'Corporate', 'Quality'];
export const EXTERNAL_ROLES: AppRole[] = ['B2B', 'Dealer'];

/** Yalnız Admin/Manager'ın okuyup yazabileceği hassas koleksiyonlar. */
export const ADMIN_ONLY_COLLECTIONS = new Set(['users', 'settings', 'invites', 'subscriptions', 'paymentHistory']);
/** Append-only: yalnız ekleme (POST). Güncelleme/silme kimseye yok. */
export const APPEND_ONLY_COLLECTIONS = new Set(['auditLog', 'syncLog', 'clientErrors']);
/** Public write: Halka açık formlar (kimlik doğrulaması olmadan yazılabilir). */
export const PUBLIC_WRITE_COLLECTIONS = new Set(['demoRequests', 'partnerApplications']);

/**
 * Rol bazlı ince ayarlı yetkilendirme (firestore.rules'dan taşınmıştır).
 * Her koleksiyon için okuma (read) ve yazma (write) izni olan rolleri tanımlar.
 * Not: Silme (delete) işlemi her zaman ADMIN_ROLES gerektirir.
 */
const COLLECTION_PERMISSIONS: Record<string, { read: AppRole[], write: AppRole[] }> = {
  // Projeler ve Görevler
  projects: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Corporate'] },
  tasks: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Logistics', 'Purchasing', 'Corporate'] },
  projectCosts: { read: ['Admin', 'Manager', 'Accounting', 'Corporate'], write: ['Admin', 'Manager', 'Accounting'] },
  projectTimelines: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Corporate'] },

  // Kalite Yönetimi (Quality)
  qcRecords: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Quality'] },
  auditItems: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Quality'] },
  fmeaRecords: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Quality'] },
  pfmeaRecords: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Quality'] },
  ctpatRecords: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Quality'] },
  kaizenRecords: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Quality'] },
  fiveSRecords: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Quality'] },
  eightDRecords: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Quality'] },
  complaints: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Quality'] },
  warranties: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Quality', 'Accounting'], write: ['Admin', 'Manager', 'Sales', 'Logistics', 'Quality'] },

  // Satış (Sales)
  leads: { read: ['Admin', 'Manager', 'Sales', 'Accounting', 'Purchasing'], write: ['Admin', 'Manager', 'Sales'] },
  customers: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  orders: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'Purchasing', 'B2B', 'Dealer'], write: ['Admin', 'Manager', 'Sales', 'Logistics', 'B2B', 'Dealer'] },
  recurringOrders: { read: ['Admin', 'Manager', 'Sales', 'B2B', 'Dealer', 'Accounting', 'Logistics'], write: ['Admin', 'Manager', 'Sales', 'B2B'] },
  // Güvenlik: B2B/Dealer dış rolleri fiyat listesi/override YAZAMAZ (kendine indirim verme açığı). Yalnız okur.
  priceLists: { read: ['Admin', 'Manager', 'Sales', 'B2B', 'Dealer', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  priceOverrides: { read: ['Admin', 'Manager', 'Sales', 'B2B', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  quotations: { read: ['Admin', 'Manager', 'Sales', 'B2B', 'Dealer', 'Accounting'], write: ['Admin', 'Manager', 'Sales', 'B2B', 'Dealer'] },
  campaigns: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  returns: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'Purchasing'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  customerRisks: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  commissionRules: { read: ['Admin', 'Manager', 'Sales', 'Dealer', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  supportTickets: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },

  // Lojistik, Depo, Üretim (Logistics / Warehouse)
  inventory: { read: [...STAFF_ROLES, 'B2B', 'Dealer'], write: ['Admin', 'Manager', 'Logistics', 'Purchasing'] }, // Warehouse combined into Logistics
  warehouseItems: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  transfers: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  waybills: { read: ['Admin', 'Manager', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Logistics'] },
  shipments: { read: ['Admin', 'Manager', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Logistics'] },
  inventoryMovements: { read: ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Logistics', 'Purchasing'] },
  warehouses: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  categories: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Purchasing'] },
  productionOrders: { read: ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting', 'Quality'], write: ['Admin', 'Manager', 'Logistics', 'Quality'] },
  machines: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  bom: { read: ['Admin', 'Manager', 'Logistics', 'Purchasing'], write: ['Admin', 'Manager', 'Logistics', 'Purchasing'] },
  capacityLines: { read: ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Quality'], write: ['Admin', 'Manager', 'Logistics'] },

  // ── Kuralı OLMAYAN koleksiyonlar (2026-08-11'de eklendi) ───────────────────
  // Bunların hepsinde ekranda ÇALIŞAN bir istemci yazma akışı vardı ama
  // COLLECTION_PERMISSIONS'ta tanımlı değillerdi → isAllowed() Zero-Trust
  // yedeğine düşüp personel rollerine SALT OKUMA veriyordu. Sonuç: Admin
  // dışındaki kullanıcıda düğme "çalışmıyor" gibi görünüyordu (yazma 403,
  // ekranda tek satır genel hata). Araç Ekle bu şekilde bulundu; aynı boşlukta
  // olan diğerleri de sahibi olan role göre burada tanımlandı.
  vehicles: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  locationStocks: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  stockCountSessions: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  stockDiscrepancies: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  stockBatches: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Quality'] },
  exportShipments: { read: ['Admin', 'Manager', 'Logistics', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Logistics'] },
  consignments: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Sales'] },
  productionMetrics: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Quality'] },
  qualityChecklist: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Quality'] },

  salesReturns: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  serviceRequests: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Logistics', 'Quality'] },
  helpdeskTickets: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales'] },
  campaignMetrics: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales'] },
  pricingRules: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales'] },

  rfqQuotes: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing'] },
  purchaseBudgets: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing', 'Accounting'] },
  supplierRisks: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing'] },
  supplierConsignments: { read: ['Admin', 'Manager', 'Purchasing', 'Logistics'], write: ['Admin', 'Manager', 'Purchasing', 'Logistics'] },

  revExpBudgets: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  autoInvoiceSchedules: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Accounting'] },
  bankReportPresets: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Accounting'] },
  bankMatchRuns: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Accounting'] },
  // Bordro çalıştırması maaş verisidir — okuma da dar tutuldu (payrolls ile aynı).
  payrollRuns: { read: ['Admin', 'Manager', 'HR', 'Accounting'], write: ['Admin', 'HR', 'Accounting'] },

  // Satın Alma (Purchasing)
  suppliers: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing'] },
  purchaseOrders: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting', 'Logistics'], write: ['Admin', 'Manager', 'Purchasing'] },
  demandRequests: { read: ['Admin', 'Manager', 'Purchasing', 'Logistics', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing', 'Sales', 'Logistics'] },

  // Muhasebe ve Finans (Accounting)
  journalEntries: { read: ['Admin', 'Accounting', 'Manager'], write: ['Admin', 'Accounting'] },
  bankAccounts: { read: ['Admin', 'Accounting', 'Manager'], write: ['Admin', 'Accounting'] },
  bankTransactions: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Accounting'] },
  checks: { read: ['Admin', 'Accounting', 'Manager'], write: ['Admin', 'Accounting'] },
  budgets: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  invoices: { read: ['Admin', 'Manager', 'Accounting', 'Sales'], write: ['Admin', 'Manager', 'Accounting'] },
  eBelgeler: { read: ['Admin', 'Manager', 'Accounting', 'Sales'], write: ['Admin', 'Manager', 'Accounting'] },
  sabitKiymetler: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Accounting'] },
  maliyetMerkezleri: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Accounting', 'Manager'] },
  maliyetKalemleri: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Accounting', 'Manager'] },
  tahsilatKayitlari: { read: ['Admin', 'Manager', 'Accounting', 'Sales'], write: ['Admin', 'Accounting', 'Sales'] },
  tahsilatOdemeleri: { read: ['Admin', 'Manager', 'Accounting', 'Sales'], write: ['Admin', 'Accounting', 'Sales'] },
  revenueContracts: { read: ['Admin', 'Manager', 'Accounting', 'Sales', 'Corporate'], write: ['Admin', 'Manager', 'Accounting', 'Sales'] },
  letterOfCredit: { read: ['Admin', 'Manager', 'Accounting', 'Sales', 'Legal', 'Logistics'], write: ['Admin', 'Manager', 'Accounting', 'Sales'] },
  recurringBilling: { read: ['Admin', 'Manager', 'Accounting', 'Sales'], write: ['Admin', 'Manager', 'Accounting', 'Sales'] },
  intercompanyTxns: { read: ['Admin', 'Manager', 'Accounting', 'Corporate'], write: ['Admin', 'Accounting'] },
  payrolls: { read: ['Admin', 'Manager', 'HR', 'Accounting'], write: ['Admin', 'HR', 'Accounting'] },

  // İnsan Kaynakları (HR)
  employees: { read: ['Admin', 'Manager', 'HR', 'Accounting'], write: ['Admin', 'HR'] },
  leaveRequests: { read: ['Admin', 'Manager', 'HR', 'Accounting'], write: ['Admin', 'HR', 'Manager'] },
  performanceReviews: { read: ['Admin', 'Manager', 'HR'], write: ['Admin', 'HR', 'Manager'] },
  trainings: { read: [...STAFF_ROLES], write: ['Admin', 'HR', 'Manager'] },
  travelRequests: { read: ['Admin', 'Manager', 'HR', 'Accounting'], write: ['Admin', 'HR', 'Manager', 'Accounting'] },

  // Hukuk ve Kurumsal (Legal / Corporate)
  legalDocuments: { read: ['Admin', 'Manager', 'Legal', 'Corporate'], write: ['Admin', 'Legal', 'Corporate'] },
  contracts: { read: ['Admin', 'Manager', 'Legal', 'Corporate', 'Sales', 'Purchasing'], write: ['Admin', 'Legal', 'Corporate'] },
  legalCases: { read: ['Admin', 'Manager', 'Legal', 'Corporate'], write: ['Admin', 'Legal', 'Corporate'] },
  complianceItems: { read: ['Admin', 'Manager', 'Legal', 'Corporate'], write: ['Admin', 'Legal', 'Corporate'] },
  boardMeetings: { read: ['Admin', 'Manager', 'Corporate', 'Legal'], write: ['Admin', 'Corporate'] },
  shareholders: { read: ['Admin', 'Manager', 'Corporate', 'Legal', 'Accounting'], write: ['Admin', 'Corporate'] },
  assemblyMeetings: { read: ['Admin', 'Manager', 'Corporate', 'Legal'], write: ['Admin', 'Corporate'] },

  // Ortak (Genel)
  documentTemplates: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Accounting'] },
  workflowTasks: { read: [...STAFF_ROLES], write: [...STAFF_ROLES] },
  approvalRequests: { read: ['Admin', 'Manager', 'HR', 'Accounting', 'Sales', 'Logistics', 'Purchasing'], write: ['Admin', 'Manager', 'HR', 'Accounting'] },

  // ── Muhasebe / Finans / Kasa / Sabit Kıymet ──
  accountingPeriods: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  taxSummary: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  taxDeclarations: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  vergiTakvimi: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  masraflar: { read: ['Admin', 'Manager', 'Accounting', 'HR', 'Sales'], write: ['Admin', 'Manager', 'Accounting', 'HR', 'Sales'] },
  payments: { read: ['Admin', 'Manager', 'Accounting', 'Sales'], write: ['Admin', 'Manager', 'Accounting'] },
  payrollEntries: { read: ['Admin', 'Manager', 'Accounting', 'HR'], write: ['Admin', 'Manager', 'Accounting', 'HR'] },
  mikroFaturalar: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  mikroCariHareketler: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  // Ham Mikro fiyat listesi aynasi; asil kullanim inventory.prices uzerinden.
  // Fiyat aynası inventory ile aynı geniş kapsamda (satışçının fiyat görmesi
  // zaten gerekli). Demirbaş/maliyet merkezi aynaları ise DAR TUTULUR — kürasyonlu
  // ekranları (sabitKiymetler/maliyetMerkezleri) Accounting'e kapalıyken ham
  // ayna [...STAFF_ROLES] ile herkese açık olsaydı (Sales/Logistics/HR/Purchasing/
  // Legal/Corporate/Quality) demirbaş alış bedeli/sigorta gibi hassas finansal
  // veriyi kürasyonlu ekrandan DAHA GENİŞ görünür kılardı (2026-08-11'de bulundu).
  mikroFiyatListeleri: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Accounting'] },
  mikroDemirbaslar: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  mikroMaliyetMerkezleri: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  revenueSchedules: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  dunningInvoices: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  dunningPolicies: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  kasalar: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  kasaHareketleri: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  kasaKapanislar: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  amortismanKayitlari: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
  sabitKiymetBakim: { read: ['Admin', 'Manager', 'Accounting', 'Logistics'], write: ['Admin', 'Manager', 'Accounting'] },
  sabitKiymetSigorta: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },

  // ── Holding ──
  holdingAccounts: { read: ['Admin', 'Manager', 'Accounting', 'Corporate'], write: ['Admin', 'Manager', 'Accounting', 'Corporate'] },
  holdingEntities: { read: ['Admin', 'Manager', 'Accounting', 'Corporate'], write: ['Admin', 'Manager', 'Corporate'] },
  holdingIntercompany: { read: ['Admin', 'Manager', 'Accounting', 'Corporate'], write: ['Admin', 'Manager', 'Accounting', 'Corporate'] },

  // ── İhracat / İthalat / Gümrük ──
  akreditifler: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Sales', 'Accounting'] },
  ihracatlar: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  ithalatlar: { read: ['Admin', 'Manager', 'Purchasing', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing', 'Logistics'] },
  gumrukBeyannameleri: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Logistics'] },

  // ── Servis / Bakım ──
  servisTalepleri: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Sales'] },
  ekipmanlar: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  arizalar: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  isEmirleri: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  teknisyenler: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  garantiler: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Quality'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },

  // ── WMS / Depo / Lojistik ──
  wmsTasks: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Purchasing'] },
  wmsCycleCounts: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  wmsLocations: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  warehouseBins: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  lotHareketleri: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  lotKayitlari: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  seriNolar: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  subeTransferler: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  cargoTracking: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  orderReturns: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  rmaRequests: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Quality'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  subeler: { read: [...STAFF_ROLES], write: ['Admin', 'Manager'] },

  // ── Üretim ──
  workCenters: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Quality'] },
  routingTemplates: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Quality'] },
  resources: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },

  // ── CPQ / Satış araçları ──
  cpqQuotes: { read: ['Admin', 'Manager', 'Sales', 'B2B', 'Dealer'], write: ['Admin', 'Manager', 'Sales'] },
  cpqTemplates: { read: ['Admin', 'Manager', 'Sales'], write: ['Admin', 'Manager', 'Sales'] },
  skuMappings: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  territories: { read: ['Admin', 'Manager', 'Sales'], write: ['Admin', 'Manager', 'Sales'] },

  // ── İK ──
  timeAttendance: { read: ['Admin', 'Manager', 'HR', 'Accounting'], write: ['Admin', 'Manager', 'HR'] },

  // ── Entegrasyon logları / Sistem ──
  dynamicsSyncLog: { read: ['Admin', 'Manager'], write: ['Admin', 'Manager'] },
  logoSyncLog: { read: ['Admin', 'Manager'], write: ['Admin', 'Manager'] },
  lucaSyncLog: { read: ['Admin', 'Manager'], write: ['Admin', 'Manager'] },
  sapSyncLog: { read: ['Admin', 'Manager'], write: ['Admin', 'Manager'] },
  jobs: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  services: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Accounting'] },
  dataRequests: { read: ['Admin', 'Manager', 'Legal'], write: ['Admin', 'Manager', 'Legal'] },
  webhookConfigs: { read: ['Admin', 'Manager'], write: ['Admin', 'Manager'] },
  legalDocs: { read: ['Admin', 'Manager', 'Legal'], write: ['Admin', 'Manager', 'Legal'] },
};

/**
 * Verilen rolün, koleksiyon+operasyon için yetkili olup olmadığını döner.
 * role null ise (kayıtsız kullanıcı) her zaman false (Public write hariç).
 */
export function isAllowed(role: AppRole | null, coll: string, op: DbOp): boolean {
  // Halka açık koleksiyonlara dışarıdan veri eklenebilir (örn: Landing page). Okumak için Admin gerekir.
  if (PUBLIC_WRITE_COLLECTIONS.has(coll) && op === 'write') return true;

  if (!role) return false;
  if (role === 'Admin') return true; // Admin her şeye yetkili

  // Append-only: güncelleme/silme kimseye yok (Admin hariç, yukarıda döndü)
  if (APPEND_ONLY_COLLECTIONS.has(coll)) {
    if (op === 'read') return ADMIN_ROLES.includes(role); // Okuma yalnız Admin/Manager
    return op === 'write' && STAFF_ROLES.includes(role);  // Sadece ekleme (POST) yapılabilir
  }

  // Hassas koleksiyonlar: yalnız Admin/Manager
  if (ADMIN_ONLY_COLLECTIONS.has(coll)) return ADMIN_ROLES.includes(role);

  // Tanımlı koleksiyonlarda granüler RBAC kuralları uygulanır
  if (coll in COLLECTION_PERMISSIONS) {
    const rules = COLLECTION_PERMISSIONS[coll];
    if (op === 'delete') return ADMIN_ROLES.includes(role); // Silme sadece Admin/Manager (Admin zaten en başta true döner)
    if (op === 'read' || op === 'write') {
      return rules[op].includes(role);
    }
  }

  // Eğer açıkça tanımlanmamış bir koleksiyon ise (güvenlik için fallback):
  // Staff rolleri okuyabilir, B2B/Dealer sadece okuyabilir.
  if (EXTERNAL_ROLES.includes(role)) return op === 'read';

  // Tanımsız yeni koleksiyonlarda yazma işlemlerini varsayılan olarak engelle (Zero Trust)
  // Sadece okumaya izin ver. Write işlemi gerekiyorsa COLLECTION_PERMISSIONS'a eklenmelidir.
  if (STAFF_ROLES.includes(role)) {
    return op === 'read';
  }

  return false;
}

/** Kullanıcının kendi users/{uid} dokümanına erişim istisnası (login senkronu). */
export function isSelfDocAccess(coll: string, docId: string | undefined, uid: string, op: DbOp): boolean {
  return coll === 'users' && !!docId && docId === uid && op !== 'delete';
}

/** Rol yükseltme engeli: users dokümanına 'role' yazımı yalnız Admin'e izinli. */
export function blocksRoleEscalation(coll: string, role: AppRole | null, body: Record<string, unknown>): boolean {
  if (coll !== 'users') return false;
  if (!('role' in body)) return false;
  return role !== 'Admin';
}
