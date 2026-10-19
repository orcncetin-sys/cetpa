/**
 * OrderTrackingView.test.tsx — kimliksiz takip sayfası (şartname `.wf/SARTNAME-takip-kodu-ve-luca-reddi.md` TC; 2026-10-19):
 * parametre `encodeURIComponent` ile gider; kod yolunun yanıtı `id` taşımaz ve `orderNo` `null` olabilir — o zaman numara satırı
 * çizilmez («#—» / «#null» basılmaz). Sunucu ucu `server/takipKoduVeLuca.zincir.test.ts`'te.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrderTrackingView from './OrderTrackingView';

const SIPARIS = {
  customerName: 'Orçun Ç.', status: 'Shipped', trackingNumber: 'YK-123456', shippingAddress: 'Muratpaşa, Antalya',
  estimatedDelivery: null, lineItems: [{ name: 'DYO Boya 15 L', quantity: 2, price: 812.5 }], updatedAt: null, createdAt: '2025-10-19T08:00:00.000Z',
};
const kur = (order: Record<string, unknown>) => {
  const f = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, order }) }));
  vi.stubGlobal('fetch', f);
  return f;
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('OrderTrackingView — takip kodu yolu', () => {
  it('parametre kodlanmış gider; `orderNo` doluysa «#<no>» çizilir (`id` alanı gerekmez)', async () => {
    const f = kur({ ...SIPARIS, orderNo: 'MF-CTP77' });
    render(<OrderTrackingView orderId="a b/c" currentLanguage="tr" />);
    expect(await screen.findByText('#MF-CTP77')).toBeTruthy();
    expect(f).toHaveBeenCalledWith('/api/track/a%20b%2Fc');
    expect(screen.getByText('Sipariş No')).toBeTruthy();
  });

  it('`orderNo: null` → numara satırı YOK; «#—», «#null» basılmaz; sayfanın kalanı çizilir', async () => {
    kur({ ...SIPARIS, orderNo: null });
    const { container } = render(<OrderTrackingView orderId="Qw12Er34Ty56Ui78Op90As" currentLanguage="tr" />);
    expect(await screen.findByText('Orçun Ç.')).toBeTruthy();
    expect(screen.queryByText('Sipariş No')).toBeNull();
    expect(container.textContent).not.toMatch(/#—|#null|#undefined/);
  });
});
