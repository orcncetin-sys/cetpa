import { Order } from '../types';

export const syncShopify = async (config?: { accessToken?: string; storeUrl?: string }): Promise<{ products: any[], orders: any[] }> => {
  const res = await fetch('/api/shopify/sync', {
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
  const res = await fetch('/api/shopify/draft-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order)
  });
  if (!res.ok) throw new Error('Draft order creation failed');
  return res.json();
};

export type DraftOrderLineItem = any;
