import { Order } from '../types';
import { authFetch } from './authFetch';

/** `POST /api/shopify/sync` yanıtı (2026-10-17, iç rol daraltma K1): uç mağazadan ürün ve siparişleri yalnız OKUR, hiçbir
 *  Cetpa koleksiyonuna yazmaz; ham diziler (müşteri kişisel verisi) dönmez — yalnız sayılar. */
export interface ShopifyOkumaOzeti { message: string; urunSayisi: number; siparisSayisi: number }

/** Erişim belirteci ve mağaza adresi gövdeden GÖNDERİLMEZ (sunucu artık kabul etmiyor; yalnız sunucu ortamından okunur). */
export const syncShopify = async (): Promise<ShopifyOkumaOzeti> => {
  const res = await authFetch('/api/shopify/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
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
