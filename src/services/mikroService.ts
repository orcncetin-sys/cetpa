/**
 * mikroService.ts — Cetpa ↔ Mikro Jump API integration (client-side)
 *
 * All real Mikro API calls are made SERVER-SIDE (server.ts /api/mikro/*)
 * because Mikro requires a whitelisted IP and OAuth credentials that must
 * never be exposed to the browser.
 *
 * This service is a thin client that calls our own Express endpoints.
 * Every result is also written back to Firebase by the server — so
 * Firebase is always the source of truth regardless of which ERP is used.
 *
 * Swapping ERPs later = only server.ts routes change. This file stays.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MikroSyncResult {
  success: boolean;
  notConfigured?: boolean;
  error?: string;
  duration?: number;
}

export interface MikroStokSyncResult extends MikroSyncResult {
  mikroStoKod?: string;
}

export interface MikroCariSyncResult extends MikroSyncResult {
  cariKod?: string;
}

export interface MikroSiparisSyncResult extends MikroSyncResult {
  mikroEvrakNo?: string | null;
}

export interface MikroListResult<T> extends MikroSyncResult {
  count: number;
  data: T[];
  duration?: number;
}

export interface MikroStatus {
  configured: boolean;
  connected: boolean;
  message?: string;
  error?: string;
}

export interface MikroStokItem {
  sto_kod: string;
  sto_isim: string;
  sto_birim1_ad?: string;
  sto_perakende_vergi?: number;
  [key: string]: unknown;
}

export interface MikroCariItem {
  cari_kod: string;
  cari_unvan1: string;
  cari_unvan2?: string;
  cari_vdaire_no?: string;
  cari_EMail?: string;
  cari_CepTel?: string;
  cari_efatura_fl?: number;
  [key: string]: unknown;
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
  return data as T;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({ configured: false, connected: false }));
  return data as T;
}

// ── Status ────────────────────────────────────────────────────────────────────

/** Check if Mikro is configured and the token endpoint is reachable */
export async function getMikroStatus(): Promise<MikroStatus> {
  return apiGet<MikroStatus>('/api/mikro/status');
}

// ── Stok (Inventory) ──────────────────────────────────────────────────────────

/**
 * Push one inventory item to Mikro (StokKaydetV2).
 * Server writes mikroStoKod + mikroSynced back to Firebase inventory/{firebaseId}.
 */
export async function syncInventoryItemToMikro(
  item: Record<string, unknown>,
  firebaseId: string
): Promise<MikroStokSyncResult> {
  return apiPost<MikroStokSyncResult>('/api/mikro/stok/kaydet', { item, firebaseId });
}

/**
 * Pull stock list from Mikro (StokListesiV2) and mirror to Firebase.
 * @param options Optional filters: stokKod prefix, date range, pagination
 */
export async function pullStokFromMikro(options?: {
  stokKod?: string;
  ilkTarih?: string;
  size?: number;
  index?: number;
}): Promise<MikroListResult<MikroStokItem>> {
  return apiPost<MikroListResult<MikroStokItem>>('/api/mikro/stok/listesi', options ?? {});
}

// ── Cari (Customer / Supplier) ────────────────────────────────────────────────

/**
 * Push a lead/customer to Mikro (CariKaydetV2).
 * Server writes mikroCariKod + mikroSynced back to Firebase leads/{firebaseId}.
 */
export async function syncLeadToMikro(
  lead: Record<string, unknown>,
  firebaseId: string
): Promise<MikroCariSyncResult> {
  return apiPost<MikroCariSyncResult>('/api/mikro/cari/kaydet', { lead, firebaseId });
}

/**
 * Pull cari list from Mikro (CariListesiV2) and mirror to Firebase.
 */
export async function pullCariFromMikro(options?: {
  whereStr?: string;
  size?: number;
  index?: number;
}): Promise<MikroListResult<MikroCariItem>> {
  return apiPost<MikroListResult<MikroCariItem>>('/api/mikro/cari/listesi', options ?? {});
}

// ── Sipariş (Order) ───────────────────────────────────────────────────────────

/**
 * Push an order to Mikro (SiparisKaydetV2).
 * Requires order.mikroCariKod to be set (sync lead first if missing).
 * Server writes mikroEvrakNo + mikroSynced back to Firebase orders/{firebaseId}.
 */
export async function syncOrderToMikro(
  order: Record<string, unknown>,
  firebaseId: string
): Promise<MikroSiparisSyncResult> {
  return apiPost<MikroSiparisSyncResult>('/api/mikro/siparis/kaydet', { order, firebaseId });
}

// ── Convenience: sync lead then order (handles missing cariKod) ───────────────

/**
 * Ensure a lead has a Mikro cari code, then push the order.
 * Use this when creating an order for a customer who may not be in Mikro yet.
 */
export async function syncOrderWithCari(
  lead: Record<string, unknown>,
  leadFirebaseId: string,
  order: Record<string, unknown>,
  orderFirebaseId: string
): Promise<{ cariResult: MikroCariSyncResult; orderResult: MikroSiparisSyncResult }> {
  // Step 1: ensure cari exists in Mikro
  let cariResult: MikroCariSyncResult;
  if (lead.mikroCariKod) {
    cariResult = { success: true, cariKod: lead.mikroCariKod as string };
  } else {
    cariResult = await syncLeadToMikro(lead, leadFirebaseId);
  }

  // Step 2: push order (inject cariKod if we just got one)
  const orderWithCari = cariResult.cariKod
    ? { ...order, mikroCariKod: cariResult.cariKod }
    : order;

  const orderResult = await syncOrderToMikro(orderWithCari, orderFirebaseId);

  return { cariResult, orderResult };
}

// ── Bulk / Manual sync triggers ───────────────────────────────────────────────

/**
 * Trigger a full pull of all Mikro stok into Firebase.
 * Intended for admin "Mikro'dan İçeri Al" button.
 */
export async function fullStokSync(): Promise<MikroListResult<MikroStokItem>> {
  return apiPost<MikroListResult<MikroStokItem>>('/api/mikro/stok/listesi', {
    size: 500,
    index: 0,
    ilkTarih: '2020-01-01',
  });
}

/**
 * Trigger a full pull of all Mikro cari into Firebase.
 * Intended for admin "Müşterileri Çek" button.
 */
export async function fullCariSync(): Promise<MikroListResult<MikroCariItem>> {
  return apiPost<MikroListResult<MikroCariItem>>('/api/mikro/cari/listesi', {
    whereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2020/01/01'",
    size: 500,
    index: 0,
  });
}

// ── Full import (Mikro → Firebase, paginated upsert) ─────────────────────────

export interface MikroImportResult extends MikroSyncResult {
  created: number;
  updated: number;
  errors:  number;
  duration?: number;
}

/**
 * Import ALL stock from Mikro into Firebase inventory.
 * Server paginates automatically and upserts each item.
 * New items are created; existing ones (matched by SKU) are updated.
 */
export async function importStokFromMikro(): Promise<MikroImportResult> {
  return apiPost<MikroImportResult>('/api/mikro/import/stok');
}

/**
 * Import ALL customers/suppliers from Mikro into Firebase leads.
 * Server paginates automatically and upserts each cari account.
 * New accounts are created; existing ones (matched by mikroCariKod) are updated.
 */
export async function importCariFromMikro(): Promise<MikroImportResult> {
  return apiPost<MikroImportResult>('/api/mikro/import/cari');
}

// ── Legacy / compatibility exports ────────────────────────────────────────────
// These match the old stub signatures so existing callers compile.
// Bank movements endpoint is not yet in the Mikro Jump Postman collection —
// it will be wired up when Mikro provides the endpoint name.

/** @deprecated Pass no config — credentials live in server env vars. */
export async function pullBankMovementsFromMikro(
  _params: Record<string, unknown>,
  _config?: unknown
): Promise<{ success: boolean; data: unknown[]; notImplemented?: boolean }> {
  // Mikro Jump API endpoint for bank movements not yet available.
  // Returns empty array so AccountingModule renders gracefully.
  return { success: false, data: [], notImplemented: true };
}
