/**
 * rbac.ts — Sunucu tarafı rol bazlı erişim politikası (saf fonksiyonlar).
 *
 * server.ts bu modülü import eder; rol DB'den okunup buraya parametre olarak
 * geçilir. DB/IO içermez → birim testle kilitlenebilir (rbac.test.ts).
 */

import { USER_SCOPED_COLLECTIONS } from './collections';

export type AppRole = 'Admin' | 'Manager' | 'Sales' | 'Logistics' | 'Accounting'
  | 'HR' | 'Purchasing' | 'B2B' | 'Dealer' | 'Legal' | 'Corporate' | 'Quality';

export type DbOp = 'read' | 'write' | 'delete';

export const ADMIN_ROLES: AppRole[] = ['Admin', 'Manager'];
export const STAFF_ROLES: AppRole[] = ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'Legal', 'Corporate', 'Quality'];
export const EXTERNAL_ROLES: AppRole[] = ['B2B', 'Dealer'];

/**
 * TUM roller — davet/rol atama uclari bunu dogrulama listesi olarak kullanir.
 *
 * server.ts'te AYRI bir `APP_ROLES` dizisi vardi: ayni 12 rol IKI KEZ
 * yaziliyordu ve biri degisince digeri sessizce bayatlardi (CLAUDE.md:
 * "grup uyeligini tek kaynaktan turet"). 2026-08-26'da birlestirildi.
 * Tip guvenligi: `AppRole[]` oldugu icin yeni bir rol tipe eklenip buraya
 * eklenmezse derleyici SUSAR — bu yuzden liste tipten TURETILMIYOR, elle
 * yaziliyor ama TEK yerde.
 */
export const APP_ROLES: readonly AppRole[] = [...STAFF_ROLES, ...EXTERNAL_ROLES];

/** Değer bir uygulama rolü mü? Prop'tan `string` gelen rolü `AppRole`'e TİP DÖNÜŞÜMÜ (`as`) olmadan daraltır; tanınmayan
 *  değer ve `null` → false (kapı soruları kapalı başarısızlıkla `null` alır). İlk çağıranlar: PurchasingModule, CRMPage. */
export function rolMu(v: unknown): v is AppRole {
  return typeof v === 'string' && APP_ROLES.some(r => r === v);
}

/** Yalnız Admin/Manager'ın okuyup yazabileceği hassas koleksiyonlar. */
export const ADMIN_ONLY_COLLECTIONS = new Set(['users', 'settings', 'invites', 'subscriptions', 'paymentHistory', 'backupConfigs']);
/** Append-only: yalnız ekleme (POST). Güncelleme/silme kimseye yok. */
export const APPEND_ONLY_COLLECTIONS = new Set(['auditLog', 'syncLog', 'clientErrors']);
/** Public write: Halka açık formlar (kimlik doğrulaması olmadan yazılabilir). */
export const PUBLIC_WRITE_COLLECTIONS = new Set(['demoRequests', 'partnerApplications']);
/**
 * Sunucu-yazar: istemci YALNIZ okur; yazma ve silme Yönetici (Admin) DÂHİL herkese kapalıdır.
 *
 * NEDEN AYRI SINIF (ölçüldü 2026-10-08): `COLLECTION_PERMISSIONS`'ta `write: []` tek başına istemci yazımını
 * KAPATMAZ — `isAllowed` Yönetici'ye her kuraldan ÖNCE `true` döner, silme de kural tablosuna bakmadan
 * Yönetici + Müdür'e açıktır. Bu sınıf o kısa yoldan ÖNCE denetlenir; böylece /api/db POST / PUT / PATCH /
 * DELETE / increment / cas (hepsi `denied()` → `isAllowed`) 403 döner.
 *
 * `magazaTalepleri`: mağazanın kimliksiz ucu (/api/magaza/siparis-talebi) ham SQL ile yazar, o yüzden
 * etkilenmez. Talep müşterinin BEYANIDIR; ekrandan düzenlenebilseydi «müşteri ne istedi» kaydı bozulurdu
 * (aşama / açıklama / kalem teslim yazımı dilim 2a'da kendi sunucu uçlarıyla gelir: `POST /api/magaza-talepleri/:id/durum`,
 * `…/kalem-teslim`, `…/bildirim-gonder` ve site paneli — tek yazma işlevi `src/server/kanal/magazaDurum.ts`; yetki aşağıdaki
 * `magazaTalepIslemYetkisi`). Dilim 2b'nin içerik düzenleme / elle talep / yumuşak silme uçları da aynı kalıptadır
 * (`POST /api/magaza-talepleri`, `…/:id/icerik`, `…/:id/sil` — yazma işlevleri `src/server/kanal/magazaIcerik.ts`; silme yetkisi
 * `magazaTalepSilmeYetkisi`): bu sınıf DEĞİŞMEZ, `/api/db` koleksiyona yine yazamaz. OKUMA kuralı `COLLECTION_PERMISSIONS`'tadır.
 *
 * `SERVER_ONLY_COLLECTIONS`'tan (collections.ts) FARKI: o sınıf okumaya da kapalıdır (/api/db ve akış).
 */
export const SUNUCU_YAZAR_COLLECTIONS = new Set(['magazaTalepleri']);

/**
 * Mağaza talebi İŞLEM yetkisi (dilim 2a, V3): site panelini görebilen ve aşama / açıklama / kalem teslim yazabilen roller =
 * `magazaTalepleri` koleksiyonunu OKUYABİLEN roller (bugün Yönetici, Müdür, Satış). Liste KOPYALANMAZ — tek kaynak
 * `COLLECTION_PERMISSIONS`. Süper-yönetici baypası YOK: rolü bu kümede olmayan süper-yönetici de 403 alır. Panel kapısı
 * ve ERP uçları `requireCollectionAccess` yerine bunu okur (`'write'` üç rolü de reddeder, `'read'` süper-yöneticiyi
 * rolüne bakmadan geçirirdi).
 */
export function magazaTalepIslemYetkisi(rol: AppRole | null): boolean {
  return isAllowed(rol, 'magazaTalepleri', 'read');
}

/**
 * Mağaza talebi SİLME ve GERİ ALMA yetkisi (dilim 2b, V17): yalnız Yönetici (`Admin`). Silme YUMUŞAKTIR (kayıt durur,
 * `silindi` işareti alır); site paneli ve ERP — İKİ kanal da bunu okur, rol karşılaştırması kopyalanmaz. Süper-yönetici
 * baypası YOK (rolü `Admin` olmayan süper-yönetici de 403 alır). `SUNUCU_YAZAR_COLLECTIONS` DEĞİŞMEZ: `/api/db` üzerinden
 * silme Yönetici dâhil herkese kapalı kalır; bu yetki yalnız sunucunun kendi silme uçları (`…/sil`) içindir.
 */
export function magazaTalepSilmeYetkisi(rol: AppRole | null): boolean {
  return rol === 'Admin';
}

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
  // Mağaza sipariş talepleri (kullanıcı kararı K3, 2026-10-08): yalnız Yönetici, Müdür ve Satış GÖRÜR; başka iç rol
  // ve hiçbir dış rol (B2B, Dealer) göremez — talep müşterinin adını / telefonunu / adresini taşır.
  // `write: []` BİLEREK boş ama tek başına YETMEZ (Yönetici kısa yolu): yazma / silme kapısı `SUNUCU_YAZAR_COLLECTIONS`.
  magazaTalepleri: { read: ['Admin', 'Manager', 'Sales'], write: [] },
  leads: { read: ['Admin', 'Manager', 'Sales', 'Accounting', 'Purchasing'], write: ['Admin', 'Manager', 'Sales'] },
  customers: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  // DIŞ ROL YOK (2026-10-11, şartname «dış rol kapanışı» D1): bu satırların altısında (orders, recurringOrders, priceLists,
  // priceOverrides, quotations, commissionRules) ve aşağıda inventory / documentTemplates / cpqQuotes'ta B2B ve Bayi vardı. Sunucuda
  // satır süzgeci yalnız `orders`'taydı: dış rol stok kartını alış maliyeti ve tedarikçisiyle, kiracının BÜTÜN müşterilerinin
  // tekliflerini, fiyat listelerini ve komisyon kurallarını okuyor, herhangi bir teklifi değiştirebiliyordu. Tabloya dış rol
  // GERİ EKLENMEZ (çit: rbac.disRol.degismez.test.ts); bayi ekranı ERP'nin dışında, kendi uçlarıyla çalışır.
  orders: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'Purchasing'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  recurringOrders: { read: ['Admin', 'Manager', 'Sales', 'Accounting', 'Logistics'], write: ['Admin', 'Manager', 'Sales'] },
  priceLists: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  priceOverrides: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  quotations: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  campaigns: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  returns: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'Purchasing'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  customerRisks: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  commissionRules: { read: ['Admin', 'Manager', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Sales'] },
  supportTickets: { read: ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting'], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },

  // Lojistik, Depo, Üretim (Logistics / Warehouse)
  inventory: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Purchasing'] }, // Warehouse combined into Logistics
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
  // Araç canlı konumu. Yazma DAR tutuldu: konum gönderen taraf lojistik
  // personeli/sürücüdür. Kuralı OLMAYAN koleksiyon Admin dışı herkese
  // salt-okunur olurdu ve konum gönderimi sessizce 403 dönerdi (bu tuzağa
  // daha önce düşüldü — bkz. hafıza: rbac-zero-trust-sessiz-403).
  vehiclePositions: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  locationStocks: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  stockCountSessions: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  stockDiscrepancies: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  stockBatches: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Quality'] },
  exportShipments: { read: ['Admin', 'Manager', 'Logistics', 'Sales', 'Accounting'], write: ['Admin', 'Manager', 'Logistics'] },
  consignments: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Sales'] },
  productionMetrics: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Quality'] },
  qualityChecklist: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Quality'] },

  // ── Ayni bosluk, ikinci tur (2026-08-25 olcumu) ─────────────────────────
  // 169 TENANT koleksiyonundan 10'u COLLECTION_PERMISSIONS'ta da
  // ADMIN_ONLY'de de yoktu. Ucu (auditLog/syncLog/clientErrors) APPEND_ONLY
  // ile zaten ele aliniyor; kalan 7 zero-trust yedegine dusuyordu.
  // `isAllowed` en basta `role === 'Admin' -> true` dondugu icin bu, tam
  // olarak "Admin'de calisiyor, digerlerinde sessizce 403" arizasi uretir:
  //   stockCounts — App.tsx:1646 sayim oturumunu arsivler (istemci yazimi)
  //   syncJobs    — syncRetryService.ts setDoc/updateDoc/deleteDoc yapar;
  //                 yazamayinca Mikro retry kuyrugu Admin olmayanda ISLEMEZ
  // Kalan 5 yalniz sunucu tarafindan yazilir (adminDb RBAC'i baypas eder),
  // ama kurali ACIKCA yazmak okumayi da netlestirir ve ileride bir ekran
  // yazmaya kalkarsa sessiz 403 yerine bilincli bir karar olur.
  stockCounts: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  // companies: firma profili (unvan/sektor/buyukluk). Onboarding'de kurucu
  // yazar (App.tsx:1128), sonrasinda Ayarlar'dan duzenlenir. TENANT'a
  // 2026-08-25'te eklendi; kuralini yazmayi unutmustum ve collections.test.ts
  // bunu yakaladi (testin var olma sebebi tam olarak bu).
  companies: { read: [...STAFF_ROLES], write: ['Admin', 'Manager'] },
  syncJobs: { read: [...STAFF_ROLES], write: [...STAFF_ROLES] },
  cariBalances: { read: ['Admin', 'Manager', 'Accounting', 'Sales'], write: ['Admin', 'Manager', 'Accounting'] },
  mikroSiparisler: { read: [...STAFF_ROLES], write: ['Admin', 'Manager'] },
  mikroDepolar: { read: [...STAFF_ROLES], write: ['Admin', 'Manager'] },
  mikroBankalar: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager'] },
  mikroKasalar: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager'] },
  // Mikro ayna ailesinin kalan ikisi. KURALSIZ birakmak artik SESSIZ 403
  // uretir: makeMikroSqlImport her import ucuna
  // `requireCollectionAccess(opts.collection, 'write')` uyguluyor, yani kurali
  // olmayan hedefte Admin DISINDAKI herkes import'u tetikleyemez.
  barkodlar: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },
  odemePlanlari: { read: ['Admin', 'Manager', 'Accounting', 'Sales'], write: ['Admin', 'Manager', 'Accounting'] },

  salesReturns: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Logistics'] },
  serviceRequests: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales', 'Logistics', 'Quality'] },
  helpdeskTickets: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales'] },
  campaignMetrics: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales'] },
  pricingRules: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Sales'] },

  rfqQuotes: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing'] },
  purchaseBudgets: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing', 'Accounting'] },
  supplierRisks: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing'] },
  supplierRatings: { read: ['Admin', 'Manager', 'Purchasing', 'Accounting'], write: ['Admin', 'Manager', 'Purchasing'] },
  reportTargets: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Accounting'] },
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
  // e-Belge Merkezi kayıtları. OKUMA = `mikroFaturalar` okuma kümesi (karar turu 2026-10-11, H2 / İ5 — «alış belgesi
  // muhasebenindir»): koleksiyon GELEN e-faturaları da taşır (tedarikçi fatura numarası, gönderen unvan, VKN, tutar, ham
  // Mikro satırı). Satış bu kümeden ÇIKARILDI — kullanıcı kararı: tedarikçi fatura numarasını Satış / Satın Alma / Lojistik
  // görmez. Satır süzgeci (yalnız giden satırları ver) reddedildi: `yon` damgası güvenilmez (import ucu damgalar, sonraki
  // import ezebilir). Sekme (`App.tsx` TAB_PERMISSIONS.ebelge) aynı kümeyle açılır. Çit: rbac.test.ts + mikroRoutes.rolKapisi.test.ts.
  eBelgeler: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
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
  // documentTemplates: 2026-09-04'te B2B / Bayi de okuyordu (B2B Portalı'ndaki teklif PDF'ini müşteri indirsin diye). Dış rol
  // kapanışıyla (2026-10-11, D1) dış rol ERP'de hiçbir koleksiyonu okumaz; B2B Portalı'nın dış role dönük dalları ölü yüzeydir
  // (şartname D7 — bu turda silinmedi, Faz 4 ölü kod listesinde).
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
  // İptal edilen Mikro faturaları (2026-09-25): mikroFaturalar ile AYNI roller (şartname kapısı C4/D1).
  mikroIptalFaturalar: { read: ['Admin', 'Manager', 'Accounting'], write: ['Admin', 'Manager', 'Accounting'] },
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
  // Urun agaci (BOM): uretim/MRP verisi — routingTemplates ile ayni yetki sinifi.
  urunAgaclari: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics', 'Quality'] },
  resources: { read: [...STAFF_ROLES], write: ['Admin', 'Manager', 'Logistics'] },

  // ── CPQ / Satış araçları ──
  cpqQuotes: { read: ['Admin', 'Manager', 'Sales'], write: ['Admin', 'Manager', 'Sales'] },
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
/**
 * Bu koleksiyon için AÇIK bir erişim kuralı tanımlı mı?
 *
 * Kuralı olmayan koleksiyon `isAllowed`in zero-trust yedeğine düşer: Admin
 * OLMAYAN personel yalnız OKUR. İstemci oraya yazıyorsa sonuç SESSİZ 403'tür —
 * kullanıcı "buton çalışmıyor" der, hiçbir log tutulmaz. Bu proje o hatayı
 * defalarca yaşadı (Araç Ekle, stockCounts sayım arşivi, syncJobs retry kuyruğu).
 *
 * `src/lib/collections.test.ts` bunu bir DEĞİŞMEZ olarak sınar: her TENANT
 * koleksiyonunun ya açık kuralı olmalı, ya ADMIN_ONLY/APPEND_ONLY olmalı.
 * Doğrudan `isAllowed('Manager', ...)` ile ölçmek YANLIŞ olur — bir kural
 * Manager'ı BİLEREK dışlayabilir (ör. shareholders yalnız Admin/Corporate).
 */
export function hasExplicitRule(coll: string): boolean {
  return coll in COLLECTION_PERMISSIONS;
}

/**
 * Açık kuralı olan koleksiyonların ADLARI (tablonun anahtarları) — değişmez testleri koleksiyon evrenini buradan türetir
 * (rbac.disRol.degismez.test.ts: «dış rol × HER koleksiyon × her işlem = false»). Yeni satır eklenince çit kendiliğinden kapsar.
 */
export const KURALLI_KOLEKSIYONLAR: readonly string[] = Object.freeze(Object.keys(COLLECTION_PERMISSIONS));

/**
 * Bir koleksiyonun tablodaki rol listeleri (KOPYA; kuralı yoksa null). YALNIZ çitler içindir — yetki kararı için `isAllowed`
 * çağrılır (Yönetici kısa yolu, sunucu-yazar, salt-ekleme ve silme kuralları tabloda değil oradadır).
 * NEDEN VAR: `isAllowed` dış rolü en başta reddeder; tabloya yanlışlıkla dış rol geri eklenirse `isAllowed` bunu göstermez —
 * çit satırın KENDİSİNE bakar ki ikinci kat (erken ret) sökülse de tablo temiz kalsın.
 */
export function kuralRolleri(coll: string): { read: readonly AppRole[]; write: readonly AppRole[] } | null {
  if (!(coll in COLLECTION_PERMISSIONS)) return null;
  const k = COLLECTION_PERMISSIONS[coll];
  return { read: [...k.read], write: [...k.write] };
}

export function isAllowed(role: AppRole | null, coll: string, op: DbOp): boolean {
  // DIŞ ROL (B2B, Bayi): HİÇBİR koleksiyonda HİÇBİR işlem (2026-10-11, şartname «dış rol kapanışı» D1). EN BAŞTA durur ki
  // aşağıdaki hiçbir dal — halka açık form, kullanıcı kapsamlı koleksiyon, kuralsız koleksiyon yedeği, tablo satırı — dış role
  // izin veremesin. Akış (`/api/db/stream`) kimliği `requireAuth`'tan geçirmeden bu işlevle karar verir: burada açık kalan her
  // hücre akıştan okunurdu (ör. `notifications` içindeki etiketsiz, sipariş metni taşıyan bildirimler).
  // TEK istisna bu işlevde DEĞİL: kişinin kendi `users/<uid>` belgesi (`isSelfDocAccess` — oturum açılışı), o AYNEN duruyor.
  // Çit: rbac.disRol.degismez.test.ts (EXTERNAL_ROLES × her koleksiyon × okuma / yazma / silme).
  if (role !== null && EXTERNAL_ROLES.includes(role)) return false;

  // Halka açık koleksiyonlara dışarıdan veri eklenebilir (örn: Landing page). Okumak için Admin gerekir.
  if (PUBLIC_WRITE_COLLECTIONS.has(coll) && op === 'write') return true;

  if (!role) return false;
  // Sunucu-yazar koleksiyon: okuma dışındaki HER işlem kapalı. Yönetici kısa yolundan ÖNCE durmak ZORUNDA —
  // altına inerse Yönetici yazar / siler, Müdür siler (bkz. SUNUCU_YAZAR_COLLECTIONS).
  if (SUNUCU_YAZAR_COLLECTIONS.has(coll) && op !== 'read') return false;
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

  // Kullanıcı-kapsamlı koleksiyonlar (userPrefs, notifications, aiConsents,
  // userOnboarding): kişinin KENDİ verisi — her İÇ rol okur/yazar (2026-10-11'e kadar «null olmayan her rol»: rol alanına
  // yazılmış geçersiz bir değer — ör. `/increment` ile sayı — bu dalı açıyordu; artık yalnız bilinen iç rol. Dış rol yukarıda döndü).
  // Sahiplik burada değil sunucuda zorlanır (injectTenant userId'yi damgalar,
  // tenantWhere yalnız kendi kayıtlarını döndürür, ownsDoc yabancıyı reddeder).
  //
  // NEDEN (2026-08-22 denetim bulgusu P3→CONFIRMED): bu koleksiyonlar
  // COLLECTION_PERMISSIONS'ta yoktu ve aşağıdaki zero-trust fallback yazmayı
  // engelliyordu — Admin olmayan TÜM roller için karanlık mod, bildirim
  // tercihleri, "son bakılanlar", hızlı not ve bildirim-okundu işareti
  // SESSİZCE kayboluyordu (istemci .catch(() => {}) ile yutuyor). Bu, RBAC
  // Zero-Trust sessiz-403 sınıfının (bkz. hafıza: 22 koleksiyon) devamıydı.
  //
  // KONUM ÖNEMLİ (2026-08-22, ikinci denetim turu): bu kontrol eskiden
  // APPEND_ONLY / ADMIN_ONLY / COLLECTION_PERMISSIONS bloklarının ÜSTÜNDEYDİ
  // ve koşulsuz `true` döndüğü için o tablolara kullanıcı-kapsamlı bir
  // koleksiyon için kural yazmak SESSİZCE ETKİSİZ olurdu — ölü kural tuzağı.
  // (Ölçüm: bugün kesişim boş, yani davranış değişmiyor; değişen tek şey,
  // yarın "aiConsents append-only olsun" denildiğinde kuralın gerçekten
  // uygulanacak olması.) Artık AÇIK kurallar önce, bu ise VARSAYILAN olarak
  // en sonda.
  if (USER_SCOPED_COLLECTIONS.includes(coll)) return STAFF_ROLES.includes(role);

  // Açık kuralı OLMAYAN koleksiyon (yedek dal): yalnız iç rol, yalnız OKUR. Dış role okuma da YOK (2026-10-11, D1) — eskiden
  // `EXTERNAL_ROLES → op === 'read'` idi: tabloya yazılmamış her koleksiyon (demoRequests, partnerApplications, …) bayiye açıktı.
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

/**
 * YALNIZ Yönetici (rol `Admin`) ya da süper yönetici — Müdür DEĞİL.
 *
 * NEDEN AYRI İŞLEV (2026-10-11, şartname «dış rol kapanışı» D10 / D11): `requireAdmin` = `ADMIN_ROLES` = Yönetici + Müdür.
 * Kullanıcı yönetimi uçları (`/api/admin/*`) o kapıyla korunuyordu ve hedefin / istenen rolün `Admin` olup olmadığına
 * bakmıyordu: Müdür kendine Yönetici rollü ikinci bir hesap açabiliyor, Yönetici'nin hesabını silebiliyordu. /api/db'de rol
 * YAZIMI zaten yasaktı (`blocksRoleEscalation`: rol yazımı yalnız Yönetici) ama SİLME açıktı: Müdür, Yönetici'nin `users`
 * belgesini `DELETE /api/db/users/<uid>` ile silebiliyordu (2026-10-17 inceleme bulgusu) — o yol da artık
 * `yoneticiRoluneDokunabilir` ile kapılı ve aynı reddi (`YONETICI_GEREKLI_YANITI`) verir. Aynı gün YAZMA yolları da (PUT / PATCH /
 * `/cas` / `/increment`): Müdür, Yönetici'nin belgesini baştan yazıp ad / e-posta gibi alanları silebiliyordu — server.ts
 * `yoneticiKaydiYazimEngeli` (silmeyle ortak yardımcı; kişinin kendi belgesi `isSelfDocAccess` istisnasıyla serbest).
 * İki adımlı doğrulama sıfırlama ucu (`POST /api/admin/users/:uid/mfa-sifirla`) da bu kapıyı kullanır.
 */
export function yalnizYoneticiMi(cagiranRol: AppRole | null, superAdmin: boolean): boolean {
  return superAdmin === true || cagiranRol === 'Admin';
}

/**
 * «Yönetici rolüne yalnız Yönetici dokunur»: çağıran, `ilgiliRol` rolünü VEREBİLİR (hesap açma, davet) / o roldeki hesabı
 * SİLEBİLİR mi? `ilgiliRol` `Admin` değilse karar bu işlevin değil çağıran ucun kendi kapısınındır (`requireAdmin`) — `true`
 * döner; Müdür'ün diğer rollerdeki kullanıcı yönetimi DEĞİŞMEZ. `ilgiliRol` ham değerdir (gövdeden / belgeden): tam olarak
 * `'Admin'` dizgisi aranır, çünkü rolü okuyan her yer (`getUserRole`, `isAllowed`) de tam eşleşmeyle karar verir.
 */
export function yoneticiRoluneDokunabilir(cagiranRol: AppRole | null, superAdmin: boolean, ilgiliRol: unknown): boolean {
  if (ilgiliRol !== 'Admin') return true;
  return yalnizYoneticiMi(cagiranRol, superAdmin);
}

/**
 * `yoneticiRoluneDokunabilir` reddinin TEK gövdesi (HTTP 403). Kullananlar: `/api/admin/users` (POST, DELETE),
 * `/api/admin/invite` (epostaRoutes) ve `/api/db/users/:id` silme + yazma yolları (server.ts `yoneticiKaydiYazimEngeli`). İstemci `code` alanından tanır; metin ve kod
 * tek yerde durur ki uçlar arasında ayrışmasın.
 */
export const YONETICI_GEREKLI_YANITI = {
  success: false,
  error: 'Yönetici rolündeki hesaplarla ilgili işlemleri yalnız Yönetici yapabilir.',
  code: 'YONETICI_GEREKLI',
} as const;
