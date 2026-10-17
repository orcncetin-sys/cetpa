/**
 * B2BPortal.test.tsx — Shopify uçlarına giden iki yüzey ROL KAPISINA bağlı mı.
 *
 * Tarihçe: 2026-10-07 (satır süzgeci inceleme bulgusu) — `POST /api/shopify/sync` personel kapılıydı; kart dış rolde çizilirse
 * her tıklama 403 → kırmızı hata iletisi. Tek kapı bileşendeki `icRol` koşuluydu ve hiçbir testi yoktu.
 * 2026-10-17 (iç rol daraltma, `.wf/SARTNAME-ic-rol-daraltma.md` S1 / S2 / K1 / K5): iki uç da kapısını ORTAK tablodan sorar
 * (`lib/entegrasyonUcKapilari`):
 *   • senkron kartı ⇔ `POST /api/shopify/sync` (`orders` okuma) — uç mağazadan yalnız OKUR; sonuç metni sayıları yeni alanlardan
 *     okur ve doğruyu söyler («… okundu (Cetpa'ya aktarılmadı)»);
 *   • «Dönüştür» (Shopify taslak siparişi) ⇔ `POST /api/shopify/draft-order` (`orders` yazma) — Muhasebe ve Satın Alma'da
 *     ÇİZİLMEZ (salt okunur sekme; bilerek kilit), istek HİÇ atılmaz.
 * Bileşen GERÇEKTEN çizilir (varsayılan alt sekme: Teklifler — kart ve teklif listesi orada). Yalnız veri katmanı, ağ, onay
 * penceresi ve Mikro düğmesi sahte.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import B2BPortal from './B2BPortal';
import { UserRole } from '../types';
import { STAFF_ROLES } from '../lib/rbac';
import { entegrasyonUcKapisindanGecer } from '../lib/entegrasyonUcKapilari';
import { syncShopify } from '../services/shopifyService';

/** Teklif listesine tek satır: «Dönüştür» düğmesi teklif ayrıntısı penceresinde. */
const TEKLIF = {
  id: 'tek-1', customerName: 'Şirin Yapı Ltd.', customerEmail: 'satin@sirin.example', status: 'Pending', totalAmount: 240,
  createdAt: '2026-10-15T10:00:00.000Z', lineItems: [{ name: 'DYO Boya 15 L', sku: 'DYO-001', price: 100, quantity: 2, vatRate: 20 }],
};
vi.mock('../lib/dbClient', () => ({
  collection: vi.fn((_db: unknown, ad: string) => ({ ad })), doc: vi.fn(() => ({})),
  query: vi.fn((hedef: { ad?: string }) => hedef), where: vi.fn(() => ({})),
  onSnapshot: vi.fn((hedef: { ad?: string }, sonraki: (g: unknown) => void) => {
    const docs = hedef.ad === 'quotations' ? [{ id: TEKLIF.id, data: () => ({ ...TEKLIF }) }] : [];
    sonraki({ docs, empty: docs.length === 0 });
    return () => {};
  }),
  addDoc: vi.fn(), updateDoc: vi.fn(() => Promise.resolve()), deleteDoc: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock('../services/shopifyService', () => ({ syncShopify: vi.fn() }));
vi.mock('../utils/pdf', () => ({ exportOrderPDF: vi.fn() }));
vi.mock('./MikroPushButton', () => ({ default: () => null }));
const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
// Onay penceresi (GlobalConfirm) bu düzenekte bağlı değil: «Dönüştür» onayı «evet» sayılır (yalnız onay — kapı DEĞİL).
vi.mock('../lib/confirm', () => ({ confirmAction: vi.fn(() => Promise.resolve(true)), confirmDelete: vi.fn(() => Promise.resolve(false)) }));

const KULLANICI = { uid: 'u1', email: 'bayi@example.com' } as User;
const DIS_ROLLER = [UserRole.B2B, UserRole.Dealer];
const IC_ROLLER = Object.values(UserRole).filter(r => !DIS_ROLLER.includes(r));
const TUM_ROLLER = Object.values(UserRole);
const ciz = (rol: UserRole) => render(
  <B2BPortal user={KULLANICI} userRole={rol} leads={[]} inventory={[]} orders={[]} currentT={{}} currentLanguage="tr" exchangeRates={null} />,
);
/** Teklif ayrıntısını açar (listede satıra tıklama) ve tembel yüklenen pencere çizilene kadar bekler. */
const teklifiAc = async (): Promise<void> => {
  fireEvent.click(screen.getByText('Şirin Yapı Ltd.'));
  await screen.findByText('Teklif Detayı');
};
const DONUSTUR = 'Siparişe Dönüştür';
const taslakIstekleri = () => authFetch.mock.calls.filter(c => c[0] === '/api/shopify/draft-order');

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ shopifyDraftOrderId: '#1001' }) }));
  vi.mocked(syncShopify).mockReset();
});
afterEach(cleanup);

describe('B2BPortal — Shopify senkron kartı ortak tablodan (`POST /api/shopify/sync` — `orders` okuma)', () => {
  /** § 7 K1 — ELLE: `orders` okuma kümesi. */
  const SENKRON_GECEN = [UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Logistics, UserRole.Accounting, UserRole.Purchasing];

  it.each(DIS_ROLLER)('dış rol %s: kart ÇİZİLMEZ', rol => {
    ciz(rol);
    expect(screen.getByText('Teklifler')).toBeInTheDocument();        // portal ve Teklifler sekmesi çizildi (boş çizim yanlış yeşil vermesin)
    expect(screen.queryByText('Shopify Senkronize Et')).toBeNull();
    expect(screen.queryByText('Shopify Entegrasyonu')).toBeNull();
  });
  it.each(SENKRON_GECEN)('geçen rol %s: kart çizilir', rol => {
    ciz(rol);
    expect(screen.getByRole('button', { name: 'Shopify Senkronize Et' })).toBeEnabled();
    expect(screen.getByText('Shopify Entegrasyonu')).toBeInTheDocument();
  });
  it.each([UserRole.HR, UserRole.Legal, UserRole.Corporate, UserRole.Quality])('kapıdan geçemeyen iç rol %s: kart ÇİZİLMEZ (b2b / crm sekmesini zaten görmez)', rol => {
    ciz(rol);
    expect(screen.getByText('Teklifler')).toBeInTheDocument();
    expect(screen.queryByText('Shopify Senkronize Et')).toBeNull();
  });
  it('12 rolün HEPSİ: kart ⇔ ortak tablo (bileşende kopya rol listesi yok)', () => {
    for (const rol of TUM_ROLLER) {
      const { unmount } = ciz(rol);
      expect(screen.queryByText('Shopify Senkronize Et') !== null, rol).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/shopify/sync'));
      unmount();
    }
    expect(TUM_ROLLER.filter(r => entegrasyonUcKapisindanGecer(r, 'POST /api/shopify/sync')).sort()).toEqual([...SENKRON_GECEN].sort());
  });
  it('K1 — sonuç metni sayıları yeni alanlardan okur ve doğruyu söyler: okundu, Cetpa\'ya aktarılmadı', async () => {
    vi.mocked(syncShopify).mockResolvedValue({ message: 'x', urunSayisi: 42, siparisSayisi: 7 });
    ciz(UserRole.Accounting);
    fireEvent.click(screen.getByRole('button', { name: 'Shopify Senkronize Et' }));
    expect((await screen.findAllByText("Shopify'dan 42 ürün, 7 sipariş okundu (Cetpa'ya aktarılmadı).")).length).toBeGreaterThan(0);
    expect(syncShopify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncShopify).mock.calls[0]).toEqual([]);       // belirteç / mağaza adresi istemciden GİTMEZ
  });
});

describe('B2BPortal — «Dönüştür» (Shopify taslak siparişi) ortak tablodan (`POST /api/shopify/draft-order` — `orders` yazma)', () => {
  /** § 2 S1 — ELLE: `orders` yazma kümesi. K5: Muhasebe ve Satın Alma sekmeyi salt okunur görür → bilerek kilitli. */
  const TASLAK_GECEN = [UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Logistics];

  it.each([UserRole.Accounting, UserRole.Purchasing])('kilitli rol %s: teklif ayrıntısında «Dönüştür» ÇİZİLMEZ, Shopify\'a istek atılmaz', async rol => {
    ciz(rol);
    await teklifiAc();                                                       // ayrıntı penceresi açıldı (boş çizim yanlış yeşil vermesin)
    expect(screen.queryByTitle(DONUSTUR)).toBeNull();
    expect(taslakIstekleri()).toEqual([]);
  });
  it.each(TASLAK_GECEN)('geçen rol %s: «Dönüştür» çizilir ve tıklama `/api/shopify/draft-order`\'a gider', async rol => {
    ciz(rol);
    await teklifiAc();
    fireEvent.click(screen.getByTitle(DONUSTUR));
    await waitFor(() => expect(taslakIstekleri()).toHaveLength(1));
  });
  it('12 rolün HEPSİ: düğme ⇔ ortak tablo', async () => {
    for (const rol of TUM_ROLLER) {
      const { unmount } = ciz(rol);
      await teklifiAc();
      expect(screen.queryByTitle(DONUSTUR) !== null, rol).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/shopify/draft-order'));
      unmount();
    }
    expect(TUM_ROLLER.filter(r => entegrasyonUcKapisindanGecer(r, 'POST /api/shopify/draft-order')).sort()).toEqual([...TASLAK_GECEN].sort());
  });
});

describe('B2BPortal — kaynak çiti', () => {
  it('«Mikro\'ya Gönder» koşulu `requireStaff` ile AYNI listeden (lib/rbac STAFF_ROLES); Shopify koşulları ortak tablodan, rol adı yazılmadan', () => {
    expect([...IC_ROLLER].map(String).sort()).toEqual([...STAFF_ROLES].sort());
    const kaynak = readFileSync(join(__dirname, 'B2BPortal.tsx'), 'utf8');
    expect(kaynak.split('const icRol = (STAFF_ROLES as readonly string[]).includes(userRole);').length - 1).toBe(1);
    expect(kaynak.split("const shopifyTaslakAcabilir = entegrasyonUcKapisindanGecer(userRole, 'POST /api/shopify/draft-order');").length - 1).toBe(1);
    expect(kaynak.split("const shopifyOkuyabilir = entegrasyonUcKapisindanGecer(userRole, 'POST /api/shopify/sync');").length - 1).toBe(1);
  });
});
