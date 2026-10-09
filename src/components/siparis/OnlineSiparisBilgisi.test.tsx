/**
 * OnlineSiparisBilgisi.test.tsx — Siparişler ekranındaki çevrim içi mağaza yüzeyleri (şartname online-siparis
 * 2026-10-02 §4): liste rozeti + sipariş detayındaki bilgi bloğu. Mağaza siparişi DEĞİLSE ikisi de hiçbir şey çizmez
 * (diğer siparişlerin detayı / satırı değişmez).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import OnlineSiparisBilgisi, { OnlineRozeti } from './OnlineSiparisBilgisi';
import type { Order } from '../../types';

const siparis = (ek: Partial<Order> = {}): Order => ({
  id: 's1', customerName: 'Ayşe Yılmaz', totalPrice: 500, status: 'Pending', customerType: 'Retail', source: 'shopify_webhook',
  shopifyOrderId: '#1001', paraBirimi: 'TRY', customerEmail: 'ayse@example.com', customerPhone: '+90 532 123 45 67',
  musteriNotu: 'Kapıya bırakmayın.\nZili çalın.',
  shopifyRaw: { financialStatus: 'partially_paid', fulfillmentStatus: null, cancelReason: null, cancelledAt: null, odemeYontemi: 'Havale / EFT', vergi: 83.33, vergiDahil: true },
  ...ek,
});
const deger = (baslik: string) => screen.getByText(baslik).nextElementSibling?.textContent;

describe('OnlineRozeti', () => {
  it('mağaza siparişinde "Online" rozeti, ipucunda açıklama', () => {
    render(<OnlineRozeti siparis={siparis()} dil="tr" />);
    expect(screen.getByText('Online').getAttribute('title')).toBe('Çevrim içi mağaza siparişi');
  });
  it('mağaza siparişi DEĞİLSE hiçbir şey çizmez — `shopifyOrderId` olan elle girilmiş sipariş dâhil', () => {
    for (const source of [undefined, 'mikro-fatura', 'Trendyol', 'shopify']) {
      const { container, unmount } = render(<OnlineRozeti siparis={siparis({ source, shopifyOrderId: 'SHP-AAAA1111' })} dil="tr" />);
      expect(container.innerHTML, String(source)).toBe('');
      unmount();
    }
  });
});

describe('OnlineSiparisBilgisi — sipariş detayındaki blok', () => {
  it('altı alan: ödeme durumu, kargo durumu, e-posta, telefon, ödeme yöntemi, müşteri notu', () => {
    render(<OnlineSiparisBilgisi siparis={siparis()} dil="tr" />);
    const blok = screen.getByRole('region', { name: 'Online sipariş bilgisi' });
    expect(within(blok).getByRole('heading', { name: 'Online sipariş bilgisi' })).toBeTruthy();
    expect(deger('Ödeme durumu')).toBe('Kısmen ödendi');          // ham 'partially_paid' DEĞİL
    expect(deger('Kargo durumu')).toBe('Hazırlanmadı');           // Shopify null = gönderilmedi
    expect(deger('E-posta')).toBe('ayse@example.com');
    expect(deger('Telefon')).toBe('+90 532 123 45 67');
    expect(deger('Ödeme yöntemi')).toBe('Havale / EFT');
    expect(deger('Müşteri notu')).toBe('Kapıya bırakmayın.\nZili çalın.');
    expect(blok.textContent).not.toContain('partially_paid');
  });
  it("eksik alanlar '—' basılır; `shopifyRaw` hiç yoksa durumlar da '—' ('Hazırlanmadı' UYDURULMAZ)", () => {
    render(<OnlineSiparisBilgisi siparis={siparis({ customerEmail: undefined, customerPhone: '  ', musteriNotu: undefined, shopifyRaw: undefined })} dil="tr" />);
    for (const baslik of ['Ödeme durumu', 'Kargo durumu', 'E-posta', 'Telefon', 'Ödeme yöntemi', 'Müşteri notu']) expect(deger(baslik), baslik).toBe('—');
  });
  it('TL siparişte tutar satırı YOK (detayın kendi "Toplam" alanı yeter)', () => {
    render(<OnlineSiparisBilgisi siparis={siparis()} dil="tr" />);
    expect(screen.queryByText('Sipariş tutarı')).toBeNull();
  });
  it("TRY dışı sipariş: tutar KENDİ biriminde + 'TL'ye çevrilmedi' notu (detayın Toplam alanı '—' basar)", () => {
    const o = siparis({ paraBirimi: 'USD', dovizTutar: 99.9 });
    Reflect.deleteProperty(o, 'totalPrice');   // sunucu TRY dışı siparişte totalPrice YAZMAZ
    render(<OnlineSiparisBilgisi siparis={o} dil="tr" />);
    const tutar = deger('Sipariş tutarı') ?? '';
    expect(tutar).toContain('$');
    expect(tutar).toContain('USD');
    expect(tutar).toContain("TL'ye çevrilmedi");
    expect(tutar).not.toContain('₺');
  });
  it("TRY dışı ama dovizTutar yok: '—' (0 uydurulmaz)", () => {
    const o = siparis({ paraBirimi: 'EUR' });
    Reflect.deleteProperty(o, 'totalPrice');
    render(<OnlineSiparisBilgisi siparis={o} dil="tr" />);
    expect(deger('Sipariş tutarı')).toMatch(/^—/);
  });
  it('EN: başlıklar ve durum etiketleri çevrilir', () => {
    render(<OnlineSiparisBilgisi siparis={siparis()} dil="en" />);
    expect(screen.getByRole('region', { name: 'Online order details' })).toBeTruthy();
    expect(deger('Payment status')).toBe('Partially paid');
    expect(deger('Fulfillment status')).toBe('Unfulfilled');
  });
  it('mağaza siparişi DEĞİLSE hiçbir şey çizmez', () => {
    const { container } = render(<OnlineSiparisBilgisi siparis={siparis({ source: 'mikro-fatura' })} dil="tr" />);
    expect(container.innerHTML).toBe('');
  });
});
