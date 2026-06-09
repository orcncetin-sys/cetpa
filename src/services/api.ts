/**
 * Cetpa API Client — src/services/api.ts
 *
 * Centralized wrapper for all /api/* server routes.
 * - Attaches Firebase ID token to every authenticated request automatically.
 * - Returns typed responses; throws ApiError on non-OK status.
 * - Never exposes raw fetch() calls in components.
 */

import { getAuth } from 'firebase/auth';

// ── Error type ────────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Internal fetch helpers ────────────────────────────────────────────────────
async function getIdToken(): Promise<string | null> {
  const user = getAuth().currentUser;
  if (!user) return null;
  try { return await user.getIdToken(); } catch { return null; }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  requiresAuth = true,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (requiresAuth) {
    const token = await getIdToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const d = await res.json() as { error?: string }; message = d.error ?? message; } catch { /* noop */ }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: unknown, auth = true) {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }, auth);
}

function get<T>(path: string, auth = false) {
  return apiFetch<T>(path, { method: 'GET' }, auth);
}

// ── Health ────────────────────────────────────────────────────────────────────
export const health = {
  check: () => get<{ status: string; firebase: boolean }>('/api/health'),
};

// ── Exchange rates ────────────────────────────────────────────────────────────
export const exchangeRates = {
  get: () => get<{ rates: Record<string, number>; source: string; updatedAt: string }>('/api/settings/exchange-rates'),
};

// ── AI ────────────────────────────────────────────────────────────────────────
export type GenerateOptions = {
  prompt: string;
  model?: string;
  systemInstruction?: string;
  thinkingLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  jsonSchema?: unknown;
};
export type ChatMessage = { role: string; parts: { text: string }[] };

export const ai = {
  generate: (opts: GenerateOptions) =>
    post<{ text: string }>('/api/ai/generate', opts),

  chat: (message: string, history: ChatMessage[] = [], systemInstruction?: string) =>
    post<{ text: string }>('/api/ai/chat', { message, history, systemInstruction }),

  demandForecast: (productId: string, historicalSales: number[]) =>
    post<{ forecast: number[]; confidence: number }>('/api/ai/demand-forecast', { productId, historicalSales }),
};

// ── Shopify ───────────────────────────────────────────────────────────────────
export const shopify = {
  sync: (accessToken: string, storeUrl: string) =>
    post<{ products: unknown[]; orders: unknown[] }>('/api/shopify/sync', { accessToken, storeUrl }),

  createDraftOrder: (payload: unknown) =>
    post<{ shopifyDraftOrderId: string }>('/api/shopify/draft-order', payload),
};

// ── Email ─────────────────────────────────────────────────────────────────────
export type EmailPayload = {
  to: string; subject: string; html: string; from?: string;
};
export const email = {
  send: (payload: EmailPayload) =>
    post<{ success: boolean; id?: string }>('/api/email/send', payload),

  orderNotification: (orderId: string, status: string) =>
    post<{ success: boolean }>('/api/email/order-notification', { orderId, status }, false),

  bulkCampaign: (payload: unknown) =>
    post<{ success: boolean; sent: number }>('/api/email/bulk-campaign', payload),

  status: () => get<{ configured: boolean }>('/api/email/status'),
};

// ── WhatsApp ──────────────────────────────────────────────────────────────────
export const whatsapp = {
  send: (to: string, message?: string, templateName?: string, templateParams?: string[]) =>
    post<{ success: boolean; provider?: string }>('/api/whatsapp/send', { to, message, templateName, templateParams }),

  orderNotification: (orderId: string, status: string, phone: string, customerName?: string, orderNo?: string) =>
    post<{ success: boolean }>('/api/whatsapp/order-notification', { orderId, status, phone, customerName, orderNo }, false),

  status: () => get<{ configured: boolean }>('/api/whatsapp/status'),
};

// ── Mikro ERP ─────────────────────────────────────────────────────────────────
export type MikroStatusResult = { configured: boolean; connected: boolean; error?: string };

export const mikro = {
  status: () => get<MikroStatusResult>('/api/mikro/status'),

  importStok: () => post<{ success: boolean; count: number }>('/api/mikro/import/stok', {}),
  importCari: () => post<{ success: boolean; count: number }>('/api/mikro/import/cari', {}),

  pullBakiye: (cariKodu: string) =>
    post<{ success: boolean; bakiye: number }>('/api/mikro/pull/bakiye', { cariKodu }),

  stokKaydet: (stok: unknown) =>
    post<{ success: boolean }>('/api/mikro/stok/kaydet', stok),

  cariKaydet: (cari: unknown) =>
    post<{ success: boolean }>('/api/mikro/cari/kaydet', cari),

  faturaKaydet: (fatura: unknown) =>
    post<{ success: boolean }>('/api/mikro/fatura/kaydet', fatura),

  irsaliyeKaydet: (irsaliye: unknown) =>
    post<{ success: boolean }>('/api/mikro/irsaliye/kaydet', irsaliye),

  siparisKaydet: (siparis: unknown) =>
    post<{ success: boolean }>('/api/mikro/siparis/kaydet', siparis),
};

// ── Luca ERP ──────────────────────────────────────────────────────────────────
export const luca = {
  status: () => get<{ configured: boolean; connected: boolean; companyName?: string; error?: string }>('/api/luca/status'),

  syncFatura: (orderId: string) =>
    post<{ success: boolean }>('/api/luca/sync/fatura', { orderId }),

  syncStok: () =>
    post<{ success: boolean; synced: number }>('/api/luca/sync/stok', {}),

  kontor: () => get<{ configured: boolean; balance?: number }>('/api/luca/kontor'),
};

// ── İyzico ────────────────────────────────────────────────────────────────────
export const iyzico = {
  status: () => get<{ configured: boolean; connected: boolean }>('/api/iyzico/status'),

  createPaymentLink: (payload: unknown) =>
    post<{ success: boolean; paymentPageUrl?: string }>('/api/iyzico/payment-link', payload),
};

// ── Stripe ────────────────────────────────────────────────────────────────────
export const stripe = {
  createCheckout: (payload: unknown) =>
    post<{ url: string }>('/api/stripe/create-checkout', payload),
};

// ── Kargo tracking ────────────────────────────────────────────────────────────
export type TrackingResult = {
  mock: boolean; carrier: string; trackingNumber: string;
  status: string; statusCode: string; estimatedDelivery?: string;
};

export const tracking = {
  aras:    (no: string) => get<TrackingResult>(`/api/tracking/aras/${no}`),
  mng:     (no: string) => get<TrackingResult>(`/api/tracking/mng/${no}`),
  yurtici: (no: string) => get<TrackingResult>(`/api/tracking/yurtici/${no}`),
  ptt:     (no: string) => get<TrackingResult>(`/api/tracking/ptt/${no}`),
  dhl:     (no: string) => get<TrackingResult>(`/api/tracking/dhl/${no}`),
  ups:     (no: string) => get<TrackingResult>(`/api/tracking/ups/${no}`),
  fedex:   (no: string) => post<TrackingResult>('/api/tracking/fedex', { trackingNumber: no }),
  order:   (orderId: string) => get<{ success: boolean; order: unknown }>(`/api/track/${orderId}`),
};

// ── Trendyol / Hepsiburada ────────────────────────────────────────────────────
export const trendyol = {
  status: () => get<{ configured: boolean; connected: boolean }>('/api/trendyol/status'),
  sync:   (daysBack = 7) => post<{ success: boolean; created: number; updated: number }>('/api/trendyol/sync', { daysBack }),
};

export const hepsiburada = {
  status: () => get<{ configured: boolean; connected: boolean }>('/api/hepsiburada/status'),
  sync:   (daysBack = 7) => post<{ success: boolean; created: number; updated: number }>('/api/hepsiburada/sync', { daysBack }),
};

// ── Inventory ─────────────────────────────────────────────────────────────────
export const inventory = {
  autoReorder: (payload: unknown) =>
    post<{ success: boolean; ordersCreated: number }>('/api/inventory/auto-reorder', payload),
};

// ── Admin ─────────────────────────────────────────────────────────────────────
export const admin = {
  stats:  () => get<Record<string, unknown>>('/api/admin/stats', true),
  invite: (email: string, role: string) => post<{ success: boolean }>('/api/admin/invite', { email, role }),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reports = {
  summary: () => get<Record<string, unknown>>('/api/reports/summary', true),
  aging:   () => get<Record<string, unknown>>('/api/aging', true),
};

// ── GİB / e-Fatura ────────────────────────────────────────────────────────────
export const gib = {
  vknSorgu: (vkn: string) => get<{ valid: boolean; title?: string }>(`/api/gib/vkn/${vkn}`),
};
