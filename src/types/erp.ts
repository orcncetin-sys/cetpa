/**
 * types/erp.ts — ERP plugin registry & shared types
 *
 * Adding a new ERP:
 *  1. Add its id to ErpId union
 *  2. Add an entry to SUPPORTED_ERPS
 *  3. Create src/components/erp/<ErpId>SyncPanel.tsx
 *  4. Add server routes at /api/<erpId>/*
 *  5. Add Firestore settings doc at settings/<erpId>
 */

// ── ERP identifier ────────────────────────────────────────────────────────────

export type ErpId =
  | 'mikro'
  | 'luca'
  | 'logo'
  | 'dynamics365'
  | 'sap';

// ── Feature flags — which sync directions each ERP supports ──────────────────

export type ErpFeature =
  | 'import_stok'    // ERP → Firebase inventory
  | 'export_stok'    // Firebase → ERP stock card
  | 'import_cari'    // ERP → Firebase leads/customers
  | 'export_cari'    // Firebase → ERP customer
  | 'export_siparis' // Firebase order → ERP sales order
  | 'export_fatura'  // Firebase order → ERP invoice
  | 'pull_bakiye'    // ERP → cari balance refresh
  | 'pull_mizan'     // ERP → trial balance
  | 'pull_kdv';      // ERP → VAT summary

// ── Per-ERP metadata (static, registered at compile time) ───────────────────

export interface ErpInfo {
  id:            ErpId;
  displayName:   string;        // shown in UI
  shortName:     string;        // chip/badge label
  vendor:        string;        // company name
  website:       string;
  logoEmoji:     string;        // fallback icon (emoji)
  brandColor:    string;        // hex
  descTr:        string;        // short description (TR)
  descEn:        string;
  apiType:       'rest' | 'odata' | 'soap' | 'service-layer';
  features:      ErpFeature[];
  statusPath:    string;        // GET /api/{id}/status
  docsUrl?:      string;
  /** env var names that must be set on the server for this ERP */
  requiredEnvVars: string[];
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const SUPPORTED_ERPS: ErpInfo[] = [
  {
    id:            'mikro',
    displayName:   'Mikro ERP (JumpBulut)',
    shortName:     'Mikro',
    vendor:        'Mikro Yazılımevi',
    website:       'https://www.mikro.com.tr',
    logoEmoji:     '💼',
    brandColor:    '#1a3a5c',
    descTr:        'Türkiye\'nin önde gelen muhasebe ve ticari yazılımı. Bulut API üzerinden stok, cari ve sipariş senkronizasyonu.',
    descEn:        'Leading Turkish accounting & business software. Stock, customer and order sync via cloud API.',
    apiType:       'rest',
    features:      ['import_stok', 'export_stok', 'import_cari', 'export_cari', 'export_siparis', 'export_fatura', 'pull_bakiye', 'pull_mizan', 'pull_kdv'],
    statusPath:    '/api/mikro/status',
    docsUrl:       'https://jumpbulut.mikro.com.tr',
    requiredEnvVars: ['MIKRO_IDM_EMAIL', 'MIKRO_IDM_PASSWORD', 'MIKRO_API_KEY', 'MIKRO_ALIAS'],
  },
  {
    id:            'luca',
    displayName:   'Luca Muhasebe',
    shortName:     'Luca',
    vendor:        'Paraşüt / Luca',
    website:       'https://www.luca.com.tr',
    logoEmoji:     '📒',
    brandColor:    '#7c3aed',
    descTr:        'e-Fatura entegrasyonu ve muhasebe senkronizasyonu. Fatura ve stok push/pull desteği.',
    descEn:        'e-Invoice integration and accounting sync. Invoice and stock push/pull support.',
    apiType:       'rest',
    features:      ['import_stok', 'export_fatura'],
    statusPath:    '/api/luca/status',
    docsUrl:       'https://developer.luca.com.tr',
    requiredEnvVars: ['LUCA_API_KEY', 'LUCA_COMPANY_ID'],
  },
  {
    id:            'logo',
    displayName:   'Logo Tiger / Go / Start',
    shortName:     'Logo',
    vendor:        'Logo Yazılım',
    website:       'https://www.logo.com.tr',
    logoEmoji:     '🐯',
    brandColor:    '#e63312',
    descTr:        'Türkiye\'nin en yaygın ERP\'i. Tiger3, Go ve Start ürün aileleri için REST API entegrasyonu.',
    descEn:        'Turkey\'s most widespread ERP. REST API integration for Tiger3, Go and Start product families.',
    apiType:       'rest',
    features:      ['import_stok', 'export_stok', 'import_cari', 'export_cari', 'export_siparis', 'export_fatura'],
    statusPath:    '/api/logo/status',
    docsUrl:       'https://developer.logo.com.tr',
    requiredEnvVars: ['LOGO_API_URL', 'LOGO_API_KEY', 'LOGO_FIRM_NO'],
  },
  {
    id:            'dynamics365',
    displayName:   'Microsoft Dynamics 365 BC',
    shortName:     'Dynamics',
    vendor:        'Microsoft',
    website:       'https://dynamics.microsoft.com/tr-tr/business-central/',
    logoEmoji:     '🪟',
    brandColor:    '#0078d4',
    descTr:        'Microsoft Dynamics 365 Business Central — OData v4 API ile stok, müşteri ve satış siparişi senkronizasyonu.',
    descEn:        'Microsoft Dynamics 365 Business Central — inventory, customer and sales order sync via OData v4 API.',
    apiType:       'odata',
    features:      ['import_stok', 'import_cari', 'export_siparis', 'export_fatura'],
    statusPath:    '/api/dynamics/status',
    docsUrl:       'https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/',
    requiredEnvVars: ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_COMPANY_ID'],
  },
  {
    id:            'sap',
    displayName:   'SAP Business One',
    shortName:     'SAP B1',
    vendor:        'SAP',
    website:       'https://www.sap.com/products/erp/business-one.html',
    logoEmoji:     '🔷',
    brandColor:    '#0070f3',
    descTr:        'SAP Business One Service Layer API ile stok, iş ortağı ve sipariş senkronizasyonu. On-premise veya cloud.',
    descEn:        'SAP Business One Service Layer API for item, business partner and order sync. On-premise or cloud.',
    apiType:       'service-layer',
    features:      ['import_stok', 'import_cari', 'export_siparis', 'export_fatura'],
    statusPath:    '/api/sap/status',
    docsUrl:       'https://help.sap.com/docs/SAP_BUSINESS_ONE/b1',
    requiredEnvVars: ['SAP_SERVICE_LAYER_URL', 'SAP_USERNAME', 'SAP_PASSWORD', 'SAP_COMPANY_DB'],
  },
];

// ── Firestore config shape (generic — per-ERP fields stored flat) ─────────────

export interface ErpBaseConfig {
  enabled:   boolean;
  connected?: boolean;
  lastSync?:  string | null;
  updatedAt?: unknown;
  [key: string]: unknown; // ERP-specific fields
}

// Logo-specific
export interface LogoConfig extends ErpBaseConfig {
  apiUrl:   string;  // e.g. https://your-server/logo-api
  apiKey:   string;
  firmNo:   string;  // e.g. "1"
}

// Dynamics 365 specific
export interface Dynamics365Config extends ErpBaseConfig {
  tenantId:   string;
  clientId:   string;
  companyId:  string; // BC company GUID
  environment: string; // e.g. "production" or "sandbox"
}

// SAP B1 specific
export interface SAPConfig extends ErpBaseConfig {
  serviceLayerUrl: string; // e.g. https://server:50000/b1s/v1
  companyDb:       string;
  username:        string;
}

// ── Shared sync result (mirrors MikroSyncResult pattern) ─────────────────────

export interface ErpSyncResult {
  success:        boolean;
  notConfigured?: boolean;
  error?:         string;
  duration?:      number;
}

export interface ErpImportResult extends ErpSyncResult {
  created:  number;
  updated:  number;
  errors:   number;
}

export interface ErpStatusResult {
  configured: boolean;
  connected:  boolean;
  message?:   string;
  error?:     string;
}
