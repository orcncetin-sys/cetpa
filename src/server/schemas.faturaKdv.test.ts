/**
 * FaturaKaydetSchema — kalemin satır KDV'si (`kdv`) şemadan GEÇER (2026-10-07).
 * zod bilinmeyen alanı siler: alan şemada olmasaydı sipariş penceresinin kaleme yazdığı satır KDV'si gövdeye hiç ulaşmaz,
 * KDV matrahtan yeniden hesaplanır ve KDV dâhil yazılan 50,01 belgede 50,02 olurdu ("yazıldı ama bağlanmadı" sınıfı).
 */
import { describe, it, expect } from 'vitest';
import { FaturaKaydetSchema } from './schemas';

// `firebaseId` 2026-10-17'den beri zorunlu (şartname «e-Fatura çift kesim» E2) — bu dosyanın konusu satır KDV'si.
const istek = (kalem: Record<string, unknown>) => ({ firebaseId: 'sip-1', order: { mikroCariKod: '120.01.001', lineItems: [{ sku: 'S1', name: 'A', price: 41.675, quantity: 1, ...kalem }], faturaTipi: 'e-arsiv', kdvOran: 20 } });

describe('FaturaKaydetSchema — satır KDV tutarı', () => {
  it('kalemin `kdv` alanı korunur', () => {
    const r = FaturaKaydetSchema.parse(istek({ kdv: 8.33 }));
    expect(r.order.lineItems[0]).toEqual({ sku: 'S1', name: 'A', price: 41.675, quantity: 1, kdv: 8.33 });
  });
  it('alan yoksa da geçerlidir (eski sipariş: sunucu KDV\'yi matrahtan hesaplar)', () => {
    expect(FaturaKaydetSchema.parse(istek({})).order.lineItems[0]).not.toHaveProperty('kdv');
  });
  it('negatif / sayı olmayan KDV reddedilir', () => {
    for (const kdv of [-1, '8,33', NaN, Infinity]) expect(FaturaKaydetSchema.safeParse(istek({ kdv })).success, String(kdv)).toBe(false);
  });
});
