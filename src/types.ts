export enum UserRole {
  Admin = 'Admin',
  Manager = 'Manager',
  Sales = 'Sales',
  Logistics = 'Logistics',
  Accounting = 'Accounting',
  HR = 'HR',
  Purchasing = 'Purchasing',
  B2B = 'B2B',
  Dealer = 'Dealer',
  Legal = 'Legal',
  Corporate = 'Corporate',
  Quality = 'Quality'
}

export type CustomerType = 'B2B' | 'Retail';
export type PriceTier = 'Retail' | 'B2B Standard' | 'B2B Premium' | 'Dealer';

export interface Shipment {
  id: string;
  customerName: string;
  destination: string;
  driver: string;
  cargoFirm: string;
  date: string;
  status: 'Pending' | 'In Transit' | 'Delivered' | 'Cancelled';
  trackingNo: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category?: string;
  stockLevel: number;
  quantity?: number;
  lowStockThreshold: number;
  minStock?: number;
  prices: Record<string, number>;
  price?: number;
  costPrice: number;
  costCurrency?: 'TRY' | 'USD' | 'EUR';
  cost?: number;
  priceCurrency?: 'TRY' | 'USD' | 'EUR';
  location?: string;
  batchNumber?: string;
  expiryDate?: string;
  supplier?: string;
  supplierSku?: string;
  syncedAt?: unknown;
  warehouseId?: string;
  description?: string;
  image?: string;
  [key: string]: unknown;
}

export interface QuotationItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  price: number;
  vatRate: number;
  inventoryId?: string;
}

export interface Quotation {
  id: string;
  customerName: string;
  customerEmail?: string;
  items?: QuotationItem[];
  lineItems?: QuotationItem[]; // Some parts use lineItems instead of items
  totalAmount?: number;
  currency?: string;
  status: 'pending' | 'approved' | 'Converted to Order' | string;
  createdAt?: unknown; // Using unknown to handle both Timestamp and string/Date
  leadId?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface OrderLineItem {
  id: string;
  sku: string;
  name: string;
  title?: string;
  quantity: number;
  price: number;
  costPrice?: number;
  vatRate?: number;
  inventoryId?: string;
  variantId?: string;
}

export interface Order {
  id: string;
  shopifyOrderId?: string;
  customerName: string;
  totalPrice: number;
  status: 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';
  trackingNumber?: string;
  shippingAddress?: string;
  location?: { lat: number; lng: number };
  syncedAt?: unknown;
  leadId?: string;
  notes?: string;
  lineItems?: OrderLineItem[];
  customerType: CustomerType;
  cargoCompany?: string;
  estimatedDelivery?: unknown;
  deliveryZone?: string;
  assignedDriver?: string;
  deliveryPhoto?: string;
  failedReason?: string;
  createdAt?: unknown;
  customerEmail?: string;
  assignedTo?: string | null;
  totalAmount?: number;
  faturali?: boolean;
  faturaTipi?: 'e-fatura' | 'e-arsiv' | 'ihracat' | null;
  kdvOran?: number;
  kdvTutari?: number;
  kdvHaricTutar?: number;
  hasInvoice?: boolean;
  mikroFaturaNo?: string;
  mikroFaturaDate?: string;
  ettn?: string;
  irsaliyeNo?: string;
  irsaliyeEttn?: string;
  mikroSynced?: boolean;
  iyzicoPaymentUrl?: string;
  iyzicoToken?: string;
  iyzicoSandbox?: boolean;
  lucaFaturaNo?: string;
  lucaSynced?: boolean;
  // Phase 89: payment tracking
  paid?: boolean;
  paidAt?: unknown;
  paymentMethod?: 'cash' | 'bank_transfer' | 'credit_card' | 'check' | 'other';
}

export type InventoryMovementCategory =
  | 'numune_promosyon'
  | 'fire_hasar'
  | 'konsinye_cikis'
  | 'konsinye_iade'
  | 'sayim_duzeltme'
  | 'depo_transfer'
  | 'arac_transfer'
  | 'lokasyon_atama';

export interface InventoryMovement {
  id: string;
  type: 'in' | 'out';
  productId?: string;
  productName: string;
  sku?: string;
  quantity: number;
  reason?: string;
  note?: string;
  // Yalnizca yeni kayitlarda dolu - eski hareketler icin undefined (geriye donuk uyumlu).
  category?: InventoryMovementCategory;
  companyId?: string | null;
  timestamp: unknown;
  [key: string]: unknown;
}

export interface Consignment {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  recipientName: string;
  quantitySent: number;
  quantitySold: number;
  quantityReturned: number;
  status: 'active' | 'closed';
  notes?: string;
  companyId?: string | null;
  createdAt: unknown;
  updatedAt?: unknown;
}

export interface StockDiscrepancy {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  ourQty: number;
  mikroQty: number;
  diff: number;
  resolved: boolean;
  companyId?: string | null;
  detectedAt: unknown;
}

export interface LeadActivity {
  id: string;
  type: 'Call' | 'Email' | 'Meeting' | 'Note' | 'Visit';
  description: string;
  date: unknown;
  user?: string;
}

export interface VoiceNote {
  id: string;
  url: string;
  createdAt: unknown;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: 'New' | 'Contacted' | 'Qualified' | 'Proposal' | 'Negotiation' | 'Closed' | 'Closed Won' | 'Closed Lost';
  score?: number;
  notes?: string;
  assignedTo: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  activities?: LeadActivity[];
  customerType: CustomerType;
  taxId?: string;
  taxOffice?: string;
  address?: string;
  authorizedContact?: string;
  creditLimit?: number;
  paymentTerms?: string;
  sector?: string;
  priceTier?: string;
  voiceNotes?: VoiceNote[];
  nextFollowUpDate?: unknown;
  cariKod?: string;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  description: string;
  category: 'Sözleşme' | 'Belge' | 'Hukuki' | 'Uyum' | 'Diğer';
  urgency: 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik';
  status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi' | 'İncelemede';
  requestedBy: string;
  approvedBy?: string;
  approvalNote?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  relatedContractId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Employee {
  id: string;
  employeeId?: string;
  mikroPersKod?: string;
  tcId?: string;
  name: string;
  position: string;
  department: string;
  salary: number;
  salaryCurrency?: string;
  startDate: string;
  email: string;
  phone: string;
  status: 'Aktif' | 'Ayrıldı' | 'İzinli';
  role: 'Admin' | 'Manager' | 'Employee';
  city: string;
  createdAt?: unknown;
}

export interface PerformanceReview {
  id: string;
  employeeId: string;
  employeeName: string;
  reviewer: string;
  date: string;
  score: number;
  comments: string;
  status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi';
  approvalStatus: 'Bekliyor' | 'Onaylandı' | 'Reddedildi';
  createdAt?: unknown;
}

export interface Training {
  id: string;
  employeeId: string;
  employeeName: string;
  title: string;
  date: string;
  provider: string;
  status: 'Tamamlandı' | 'Devam Ediyor' | 'Planlandı';
  createdAt?: unknown;
}

export interface TravelRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  destination: string;
  city: string;
  startDate: string;
  endDate: string;
  advanceAmount: number;
  status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi';
  approvalStatus: 'Bekliyor' | 'Onaylandı' | 'Reddedildi';
  notes?: string;
  createdAt?: unknown;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'Yıllık İzin' | 'Hastalık' | 'Mazeret' | 'Diğer';
  startDate: string;
  endDate: string;
  days: number;
  status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi';
  approvalStatus: 'Bekliyor' | 'Onaylandı' | 'Reddedildi';
  notes?: string;
  createdAt?: unknown;
}

export interface Payroll {
  id: string;
  employeeId: string;
  employeeName: string;
  month: number;
  year: number;
  baseSalary: number;
  bonus: number;
  deductions: number;
  deduction?: number; // Added for compatibility with HRModule
  netSalary: number;
  status: 'Ödendi' | 'Bekliyor' | 'Taslak';
  currency?: string;
  createdAt?: unknown;
}

export interface Contract {
  id: string;
  no: string;
  title: string;
  party: string;
  type: string;
  startDate: string;
  endDate: string;
  status: 'Aktif' | 'Yenileme Bekliyor' | 'Süresi Dolan' | 'Taslak';
  value: number;
  currency: string;
  createdAt?: unknown;
}

export interface LegalCase {
  id: string;
  no: string;
  title: string;
  type: string;
  court: string;
  plaintiff: string;
  defendant: string;
  lawyer: string;
  status: 'Devam Ediyor' | 'Kazanılan' | 'Kaybedilen' | 'Temyiz';
  nextHearing?: string;
  amount: number;
  description: string;
  createdAt?: unknown;
}

export interface ComplianceItem {
  id: string;
  title: string;
  isCritical: boolean;
  responsible: string;
  nextDate: string;
  description: string;
  status: 'Uyumlu' | 'Uyumsuz' | 'İncelemede' | 'Planlı';
  createdAt?: unknown;
}

export interface BankAccount {
  id: string;
  bankName: string;
  branch: string;
  accountHolder: string;
  accountNumber: string;
  iban: string;
  currency: 'TRY' | 'USD' | 'EUR';
  balance: number;
  accountType: 'Vadesiz' | 'Vadeli' | 'Kredi' | 'Kasa';
  openingBalance?: number;   // dönem/hesap açılış (devir) bakiyesi — hesabın kendi para biriminde
  openingDate?: string;      // açılış bakiyesinin geçerli olduğu tarih (YYYY-MM-DD)
  updatedAt?: unknown;
}

export interface BankTransaction {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  balance: number;
  currency: 'TRY' | 'USD' | 'EUR';
  reference?: string;
  source: 'mikro' | 'manual' | 'import';
  costCenterId?: string;     // maliyet/sorumluluk merkezi (opsiyonel)
  costCenterName?: string;
  companyId?: string | null;
  createdAt?: unknown;
}

// Banka bakiye raporu kayıtlı filtre şablonu (kaydet/yükle).
export interface BankReportPreset {
  id: string;
  name: string;
  asOf?: string;
  costCenterId?: string;
  companyId?: string | null;
  createdAt?: unknown;
}

export interface JournalEntry {
  id: string;
  date: string;
  fiş: string;
  aciklama: string;
  debitHesap: string;
  alacakHesap: string;
  borc: number;
  alacak: number;
  kdvOran?: number;
  kategori: 'Satış' | 'Alış' | 'Gider' | 'Tahsilat' | 'Ödeme' | 'Diğer';
  isSynced?: boolean;
  createdAt?: unknown;
}

export interface Customer { id: string; name: string; company?: string; email?: string; phone?: string; address?: string; taxNo?: string; taxOffice?: string; notes?: string; createdAt?: unknown; creditLimit?: number; balance?: number; riskGroup?: 'Düşük' | 'Orta' | 'Yüksek'; /** Mikro cari kodu — fatura satırlarında müşteri adını çözmek için. */ mikroCariKod?: string; }
export interface Supplier { id: string; name: string; company?: string; email?: string; phone?: string; address?: string; taxNo?: string; taxOffice?: string; notes?: string; createdAt?: unknown; mikroCariKod?: string; }
export interface Service { id: string; code: string; name: string; type: 'Ürün' | 'Hizmet'; unitPrice: number; vatRate: number; unit: string; notes?: string; createdAt?: unknown; }
export interface WarehouseItem { id: string; productName: string; sku?: string; quantity: number; warehouseId?: string; location?: string; category?: string; notes?: string; updatedAt?: unknown; }
export interface Transfer { id: string; fromWarehouse: string; toWarehouse: string; productName: string; quantity: number; date: string; notes?: string; status: 'Bekliyor' | 'Tamamlandı' | 'İptal'; createdAt?: unknown; }
export interface Check { id: string; checkNo: string; bankName: string; amount: number; dueDate: string; drawer: string; type: 'Alınan' | 'Verilen'; status: 'Aktif' | 'Tahsil Edildi' | 'İade'; createdAt?: unknown; }
export interface WaybillItem { productName: string; sku: string; quantity: number; unitPrice: number; taxRate: number; }
export interface Waybill { id: string; waybillNo: string; invoiceNo?: string; party: string; date: string; items: WaybillItem[]; total?: number; status: 'Bekliyor' | 'Tamamlandı' | 'İptal'; type: 'giden' | 'gelen'; warehouseId?: string; createdAt?: unknown; }
export interface Budget { id: string; category: string; amount: number; period: string; }
export interface Warehouse { id: string; name: string; location?: string; manager?: string; notes?: string; createdAt?: unknown; }

// Araç filosu — kalıcı (Firestore 'vehicles'). QR-tabanlı depo/araç transferinde
// araçlar da bir "lokasyon" olarak kullanılır (bkz. locationQrValue / parseLocationQr).
export interface Vehicle {
  id: string;
  plate: string;
  driver?: string;
  model?: string;
  status: 'Müsait' | 'Yolda' | 'Bakımda' | 'Arızalı';
  lastService?: string;
  nextService?: string;
  km?: number;
  fuel?: 'Benzin' | 'Dizel' | 'LPG' | 'Elektrik';
  companyId?: string | null;
  createdAt?: unknown;
}

// Konum-bazlı stok — her depo/araç + ürün için ayrı miktar (Faz 2). Global
// InventoryItem.stockLevel = tüm locationStocks'un toplamı olarak korunur.
export interface LocationStock {
  id: string;              // `${locationType}:${locationId}:${productId}`
  locationType: 'warehouse' | 'vehicle';
  locationId: string;
  locationName?: string;
  productId: string;
  sku?: string;
  productName?: string;
  quantity: number;
  companyId?: string | null;
  updatedAt?: unknown;
}
export interface BoardMeeting { id: string; title: string; date: string; location: string; attendees: string; decisions: string; status: 'Planlandı' | 'Tamamlandı' | 'İptal'; createdAt?: unknown; updatedAt?: unknown; }
export interface AssemblyMeeting { id: string; title: string; date: string; type: 'Olağan' | 'Olağanüstü'; decisions: string; attendees: string; createdAt?: unknown; }
export interface Shareholder { id: string; name: string; shareCount: number; sharePercentage: number; type: 'Gerçek Kişi' | 'Tüzel Kişi'; contact?: string; createdAt?: unknown; updatedAt?: unknown; }
export interface LegalDoc { id: string; title: string; type: string; date: string; status: string; notes?: string; fileUrl?: string; fileName?: string; fileSize?: number; uploadedBy?: string; createdAt?: unknown; }

export interface PriceListItem {
  productId: string;
  name: string;
  sku: string;
  basePrice: number;
  customPrice: number;
}

export interface RouteStop {
  orderId: string;
  customerName: string;
  address: string;
  location: { lat: number; lng: number };
  status: string;
  estimatedMinutes: number;
  sequence: number;
}

export interface PriceList {
  id: string;
  productId?: string;
  productName?: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  items?: PriceListItem[];
  prices?: Record<string, number>;
  notes?: string;
  [key: string]: unknown;
}

export interface LucaConfig {
  apiKey: string;
  companyId: string;
  baseUrl: string;
  lastSync?: string | null;
  connected?: boolean;
  enabled?: boolean;
  updatedAt?: any;
}

export interface MikroConfig {
  enabled: boolean;
  // IDM credentials (Online İşlem Merkezi login → Bearer token)
  idmEmail?: string;
  idmPassword?: string;      // "1234..." from Online İşlem Merkezi
  // Mikro Jump API context (body of every request)
  alias?: string;            // e.g. "XCXY-8332"
  firmaKodu?: string;        // e.g. "01"
  calismaYili?: string;      // e.g. "2026"
  apiKey?: string;           // from Mikro admin portal
  kullaniciKodu?: string;    // e.g. "SRV"
  sifre?: string;            // MD5-hashed server user password
  firmaNo?: number;
  subeNo?: number;
  // Status & metadata
  lastSync?: string | null;
  syncedCount?: number;
  connected?: boolean;
  updatedAt?: unknown;
  // Legacy compat
  accessToken?: string;      // maps to idmPassword
  endpoint?: string;
}
