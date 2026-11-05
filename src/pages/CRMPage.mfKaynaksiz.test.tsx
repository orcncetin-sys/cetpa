/**
 * CRMPage.mfKaynaksiz.test.tsx — CRM ciro blokları kaynaksız MF'yi (Mikro'da satış faturası olmayan, sunucunun işaretlediği MF
 * siparişi) CİRODAN düşer; sipariş SAYISI değişmez (şartname «Mikro bağlantı B» B2; MB1 hakem bulgusu 2, 05.11.2026).
 *
 *   • Hedefler (Phase 142): işaretli MF'nin temsilcisi «₺0 · 1 sipariş» görünür (adet ham, ciro kapılı); bu ayın gerçekleşeni yalnız
 *     yerel sipariş; not `data-mf-kaynaksiz-notu="crm-hedefler"`.
 *   • En Yüksek Ciro (Phase 45): işaretli MF'nin müşterisi sıralamada YOK; not `data-mf-kaynaksiz-notu="crm-siralama"`.
 *   • İşaretsiz MF (QH2-1) bugünkü gibi sayılır.
 *
 *   • Müşteri detayı CLV şeridi (Y29 bulgu 0): «Ort. Sipariş» pay da payda da kapılı (₺10.000 normal + ₺10.000 işaretli MF → ₺10.000);
 *     12A CLV eskisiyle özdeş (`totalRev / tenureMonths × 12`); tek siparişi işaretli MF olan müşteride «—»; not `crm-clv`.
 *
 * Mutasyon (yapılıp geri alındı, raporda): Hedefler ciro döngüsünde / sıralamada `ciroSiparisleri` yerine `orders` → kırmızı;
 * CLV şeridinde payda `custOrders.length` → kırmızı; CLV `aov × ordersPerMonth × 12` (yeni aov ile) → kırmızı.
 * Ağır ve ilgisiz alt bileşenler boş çizilir (CRMPage.mikroCariBagla.test.tsx kalıbı).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, within } from '@testing-library/react';
import { UserRole, type Lead, type Order } from '../types';
import { MF_KAYNAGI } from '../lib/mfKaynagi';
import { useAppStore } from '../store/appStore';
import CRMPage from './CRMPage';

vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: { currentUser: { uid: 'u-1', getIdToken: async () => 'belirtec' }, onAuthStateChanged: () => () => {} },
}));
vi.mock('../lib/dbClient', async (asil) => {
  const a = await asil<typeof import('../lib/dbClient')>();
  return { ...a, onSnapshot: vi.fn(() => () => {}) };
});
vi.mock('../components/CariEkstrePanel', () => ({ default: () => null }));
vi.mock('../components/MutabakatPanel', () => ({ default: () => null }));
vi.mock('../components/DealerCommissionPanel', () => ({ default: () => null }));
vi.mock('../components/AccountingModule', () => ({ default: () => null }));
vi.mock('../components/B2BPortal', () => ({ default: () => null }));
vi.mock('../components/SatisAjaniPanel', () => ({ default: () => null }));
vi.mock('../components/AIInlineNudge', () => ({ default: () => null }));

const BU_AY = new Date();
const TARIH = new Date(BU_AY.getFullYear(), BU_AY.getMonth(), 10, 12).toISOString();
const siparis = (ek: Record<string, unknown>): Order => ({
  status: 'Delivered', createdAt: TARIH, customerType: 'B2B', lineItems: [], ...ek,
}) as unknown as Order;
const ISARETLI = siparis({
  id: 'mikrofat__A__-325', source: MF_KAYNAGI, mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z',
  totalPrice: 1000, assignedTo: 'Temsilci X', customerName: 'Kaynaksız Müşteri',
});
const ISARETSIZ = siparis({ id: 'mikrofat__A__-400', source: MF_KAYNAGI, totalPrice: 300, assignedTo: 'Temsilci Z', customerName: 'İşaretsiz Müşteri' });
const YEREL = siparis({ id: 'ord-1', totalPrice: 600, assignedTo: 'Temsilci Y', customerName: 'Yerel Müşteri' });
const NOT = "₺1.000,00 Mikro'da satış faturası olmayan MF siparişi dâhil değil · 1 kayıt";

async function ac(crmTab: string, orders: Order[], selectedLead: Lead | null = null): Promise<HTMLElement> {
  useAppStore.setState({ userRole: UserRole.Admin, companyId: 'CETPA' });
  const bos = () => {};
  const { container } = render(
    <React.Suspense fallback={null}>
      <CRMPage
        crmTab={crmTab} setCrmTab={bos} monthlyTarget={1000} monthlyTargets={{}} saveMonthlyTarget={bos}
        selectedLead={selectedLead} setSelectedLead={bos} hasFullAccess={() => true}
        currentLanguage="tr" currentT={{}} orders={orders} leads={[]} inventory={[]} exchangeRates={null} employees={[]}
        userRole={UserRole.Admin} user={{ uid: 'u-1', email: 'u@example.test' }} kpiCurrency="TRY" setKpiCurrency={bos}
        appQuotations={[]} activeTab="crm" darkMode={false} warehouses={[]} supportTickets={[]} commissionRules={[]} p549Iadeler={[]}
        trackView={bos} setIsEditingLead={bos} setEmailCompose={bos} handleToggleOrderPaid={bos} openConfirm={bos} toast={bos}
        setActiveTab={bos} setIsAddingLead={bos} setSelectedOrder={bos} setIsAddingOrder={bos} logAuditAction={async () => {}}
      />
    </React.Suspense>,
  );
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  return container;
}
/** Temsilci satırının sağ hücresi: «₺600 · 1 sipariş». İlk satırın adı «🏆» önekiyle basılır (`{i === 0 && '🏆'}{r.rep}`). */
const temsilciHucresi = (ad: string): string => {
  const etiket = screen.getAllByText((_m, e) => e?.tagName === 'SPAN' && (e.textContent === ad || e.textContent === `🏆${ad}`))
    .find(e => e.closest('div.flex.items-center.justify-between'));
  if (!etiket) throw new Error(`temsilci satırı yok: ${ad}`);
  const satir = etiket.closest('div.flex.items-center.justify-between');
  if (!satir) throw new Error(`satır yok: ${ad}`);
  return (satir.lastElementChild?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

afterEach(() => {
  cleanup();
  useAppStore.setState({ userRole: UserRole.Sales, companyId: null });
});

describe('CRMPage — kaynaksız MF ciro dışı, sayım ham (B2 / MB1 bulgu 2)', () => {
  it('Hedefler: işaretli MF temsilcisi ₺0 · 1 sipariş; bu ay gerçekleşen işaretsiz + yerel; not basılır', async () => {
    const kap = await ac('hedefler', [ISARETLI, ISARETSIZ, YEREL]);
    expect(temsilciHucresi('Temsilci X')).toBe('₺0 · 1 sipariş');
    expect(temsilciHucresi('Temsilci Y')).toBe('₺600 · 1 sipariş');
    expect(temsilciHucresi('Temsilci Z')).toBe('₺300 · 1 sipariş');   // işaretsiz MF bugünkü gibi (QH2-1)
    expect(kap.querySelector('span.text-3xl')?.textContent).toBe('₺900');   // «Bu Ay» kartının gerçekleşeni: 600 + 300
    const not = kap.querySelector('[data-mf-kaynaksiz-notu="crm-hedefler"]');
    expect(not?.textContent).toBe(NOT);
  });

  it('Hedefler: işaretli MF yoksa not basılmaz', async () => {
    const kap = await ac('hedefler', [ISARETSIZ, YEREL]);
    expect(kap.querySelector('[data-mf-kaynaksiz-notu="crm-hedefler"]')).toBeNull();
  });

  it('En Yüksek Ciro: işaretli MF müşterisi sıralamada yok; işaretsiz ve yerel var; not basılır', async () => {
    const kap = await ac('leads', [ISARETLI, ISARETSIZ, YEREL]);
    const baslik = screen.getByText('En Yüksek Ciro');
    const kart = baslik.closest('div.bg-white');
    if (!(kart instanceof HTMLElement)) throw new Error('sıralama kartı yok');
    expect(within(kart).queryByText('Kaynaksız Müşteri')).toBeNull();
    expect(within(kart).getByText('Yerel Müşteri')).toBeInTheDocument();
    expect(within(kart).getByText('İşaretsiz Müşteri')).toBeInTheDocument();
    expect(kap.querySelector('[data-mf-kaynaksiz-notu="crm-siralama"]')?.textContent).toBe(NOT);
  });

  // Y29 bulgu 0: müşteri detayının CLV şeridi. Değer hücresi etiketin hemen önündeki <p>.
  const MUSTERI: Lead = { id: 'aday-clv', name: 'Detay Müşteri', company: 'Detay Ltd.', status: 'Qualified', assignedTo: 'Temsilci X' } as unknown as Lead;
  const DETAY_NORMAL = siparis({ id: 'ord-clv-1', totalPrice: 10000, customerName: 'Detay Müşteri' });
  const DETAY_ISARETLI = siparis({
    id: 'mikrofat__A__-422', source: MF_KAYNAGI, mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z',
    totalPrice: 10000, customerName: 'Detay Müşteri',
  });
  const DETAY_ISARETSIZ = siparis({ id: 'mikrofat__A__-430', source: MF_KAYNAGI, totalPrice: 10000, customerName: 'Detay Müşteri' });
  const seritDegeri = (etiket: string): string => {
    const e = screen.getAllByText(etiket).find(x => x.tagName === 'P' && x.className.includes('text-[9px]'));
    if (!e) throw new Error(`şerit etiketi yok: ${etiket}`);
    return (e.previousElementSibling?.textContent ?? '').trim();
  };

  it('Müşteri detayı: normal ₺10.000 + işaretli MF ₺10.000 → Ort. Sipariş ₺10.000, CLV ₺120.000, Sıklık ham 2.0; not crm-clv', async () => {
    const kap = await ac('leads', [DETAY_NORMAL, DETAY_ISARETLI], MUSTERI);
    expect(seritDegeri('Ort. Sipariş')).toBe('₺10.000');
    expect(seritDegeri('12A CLV')).toBe('₺120.000');   // aynı gün iki sipariş: tenure 1 ay; eski formül de 5.000 × 2 × 12 = 120.000
    expect(seritDegeri('Sıklık/Ay')).toBe('2.0');      // adet ham
    expect(kap.querySelector('[data-mf-kaynaksiz-notu="crm-clv"]')?.textContent)
      .toBe("₺10.000,00 Mikro'da satış faturası olmayan MF siparişi dâhil değil · 1 kayıt");
  });

  it('Müşteri detayı: tek siparişi işaretli MF → Ort. Sipariş «—», CLV ₺0; not basılır', async () => {
    const kap = await ac('leads', [DETAY_ISARETLI], MUSTERI);
    expect(seritDegeri('Ort. Sipariş')).toBe('—');
    expect(seritDegeri('12A CLV')).toBe('₺0');
    expect(kap.querySelector('[data-mf-kaynaksiz-notu="crm-clv"]')).not.toBeNull();
  });

  it('Müşteri detayı: işaretsiz MF bugünkü gibi sayılır (QH2-1), not basılmaz', async () => {
    const kap = await ac('leads', [DETAY_NORMAL, DETAY_ISARETSIZ], MUSTERI);
    expect(seritDegeri('Ort. Sipariş')).toBe('₺10.000');
    expect(seritDegeri('12A CLV')).toBe('₺240.000');
    expect(kap.querySelector('[data-mf-kaynaksiz-notu="crm-clv"]')).toBeNull();
  });
});
