import { Order } from '../types';
import { authFetch } from './authFetch';

export const syncShopify = async (config?: { accessToken?: string; storeUrl?: string }): Promise<{ products: any[], orders: any[] }> => {
  const res = await authFetch('/api/shopify/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken: config?.accessToken,
      storeUrl: config?.storeUrl
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Sync failed' }));
    throw new Error(err.error || 'Sync failed');
  }
  return res.json();
};

export const createShopifyDraftOrder = async (order: Order): Promise<{ shopifyDraftOrderId: string }> => {
  const res = await authFetch('/api/shopify/draft-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order)
  });
  // Sunucunun gerekçesini OKU (ör. 422 "Shopify kesirli miktar kabul etmez") — eskiden gövde atılıp sabit metin fırlatılıyordu.
  if (!res.ok) {
    const govde = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(govde.error || 'Draft order creation failed');
  }
  return res.json();
};

export type DraftOrderLineItem = any;
