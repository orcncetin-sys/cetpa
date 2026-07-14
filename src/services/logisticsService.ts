/**
 * logisticsService.ts — konum-bazlı stok transfer istemcisi.
 * Tüm iş sunucu tarafında atomik (POST /api/logistics/transfer); bu dosya
 * ince bir sarmalayıcı + istemci tarafı okuma yardımcılarıdır.
 */
import { authFetch } from './authFetch';
import type { LocationStock } from '../types';

export type LocationRef = { type: 'warehouse' | 'vehicle'; id: string; name?: string };

export interface TransferPayload {
  productId: string;
  sku?: string;
  productName?: string;
  quantity: number;
  from?: LocationRef | null;   // null → dışarıdan giriş (lokasyon atama / mal kabul)
  to?: LocationRef | null;     // null → dışarı çıkış (sevkiyat/fire)
  note?: string;
  transferId?: string;         // P12: idempotency anahtarı (verilmezse otomatik üretilir)
}

export interface TransferResult {
  success: boolean;
  movementId?: string;
  category?: string;
  error?: string;
  available?: number;          // 409'da kaynak lokasyondaki mevcut miktar
}

export async function transferStock(payload: TransferPayload): Promise<TransferResult> {
  try {
    // P12: her transfer denemesine sabit bir idempotency anahtarı ver — ağ retry'ı
    // / çift gönderim aynı anahtarı taşır, sunucu ikinci kez uygulamaz.
    const body = { transferId: crypto.randomUUID(), ...payload };
    const res = await authFetch('/api/logistics/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    return data as TransferResult;
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** locationStocks doküman kimliği — sunucudakiyle aynı biçim. */
export function locationStockDocId(type: 'warehouse' | 'vehicle', locationId: string, productId: string): string {
  return `${type}__${locationId}__${productId}`;
}

/** İstemci tarafı: bir lokasyondaki bir ürünün mevcut miktarı (yoksa 0). */
export function getLocationQty(
  locationStocks: LocationStock[],
  type: 'warehouse' | 'vehicle',
  locationId: string,
  productId: string,
): number {
  const id = locationStockDocId(type, locationId, productId);
  return locationStocks.find(s => s.id === id)?.quantity ?? 0;
}
