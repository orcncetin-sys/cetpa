/**
 * OrdersPage.faturaGonderimi.test.tsx — e-Fatura gönderim işaretinin SAYFADAKİ karşılığı, sayfa GERÇEKTEN çizilerek
 * (2026-10-17, şartname «e-Fatura çift kesim» § 7.4 B1, B4, B8 (sayfa kolu), B9 (sayfa kolu)).
 *
 * Saf kurallar `utils/siparisler/faturaDurumu.gonderim.test.ts`'te; kilit `belgeKilidi.test.ts`'te; App.tsx işleyicisi (onay
 * penceresi, uçuş kilidi, yanıt yaması) GERÇEK App'te `components/MikroFatura.uygulama.test.tsx`'te. Burada sınanan: ayrıntı
 * ve liste CANLI kayıttan (`orders`) çizilir — bayat `selectedOrder` kopyası işaretsiz olsa da (D8); düzenleme kilidi aynı
 * yüklemden (D10); rozetler ve sarı «gönderilmedi» noktası (D12); belirsiz siparişte iki seçenek ve doğru çağrı (D6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import OrdersPage from './OrdersPage';
import { translations } from '../translations';
import { useAppStore } from '../store/appStore';
import { FATURA_GONDERIM_BAYATLIK_MS } from '../lib/faturaGonderimi';
import type { Order } from '../types';

vi.mock('../lib/dbClient', async (asil) => ({
  ...(await asil<typeof import('../lib/dbClient')>()),
  onSnapshot: () => () => {},
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
}));
vi.mock('../services/authFetch', () => ({
  authFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }) })),
}));

type Props = ComponentProps<typeof OrdersPage>;
const bos = () => {};
const sozBos = () => Promise.resolve();

const siparis = (ek: Partial<Order> = {}): Order =>
  ({ id: 'sip-1', customerName: 'Şirin Yapı', totalPrice: 1200, status: 'Processing', customerType: 'B2B', orderNumber: 'S-1', lineItems: [], faturali: true, kdvOran: 20, ...ek });
const isaret = (durum: Order['mikroFaturaGonderimi'] extends infer T ? T extends { durum: infer D } ? D : never : never, ek: Record<string, unknown> = {}, zamanMs = Date.now() - 1_000) =>
  ({ mikroFaturaGonderimi: { durum, istekNo: 'i-1', zaman: new Date(zamanMs).toISOString(), kim: 'satis@example.test', ...ek } }) as Partial<Order>;

function ciz(secili: Order | null, canli: Order[], ek: Partial<Props> = {}) {
  const handleMikroFatura = vi.fn<Props['handleMikroFatura']>(() => Promise.resolve());
  const handleMikroFaturaSonuc = vi.fn<Props['handleMikroFaturaSonuc']>(() => Promise.resolve());
  const ozellikler: Props = {
    selectedOrder: secili, setSelectedOrder: vi.fn(), lojistikTab: 'sevkiyat', setLojistikTab: bos,
    routeStops: [], isRouteOptimized: false, selectedDepot: 'eski_sanayi', setSelectedDepot: bos,
    DEPOTS: { eski_sanayi: { name: 'Eski Sanayi', lat: 36.9, lng: 30.7 }, havalimani: { name: 'Havalimanı', lat: 36.9, lng: 30.8 } },
    recurringOrders: [], hasFullAccess: () => true, siparisDetayiAcilabilir: true,
    currentLanguage: 'tr', currentT: translations.tr,
    orders: canli, leads: [], inventory: [], exchangeRates: null, employees: [],
    userRole: 'Admin', user: { uid: 'uid-7', email: 'yonetici@ornek.com.tr', displayName: 'Yönetici' },
    kpiCurrency: 'TRY', setKpiCurrency: bos, activeTab: 'orders', darkMode: false,
    warehouses: [], vehicles: [], aracKonumlari: [], konumYazabilir: false, irsaliyeKesebilir: false, kullaniciUid: 'uid-7',
    locationStocks: [], shipments: [], setSiparisTohumu: vi.fn(),
    handleMikroFatura, handleMikroFaturaSonuc, mikroFaturaGonderiliyor: {}, mikroFaturaKesebilir: true, mikroFaturaSonucuCozebilir: true,
    handleEIrsaliye: sozBos, eIrsaliyeGonderiliyor: {}, handleIyzicoPaymentLink: sozBos,
    setRouteStops: bos, p554Bins: [], handleBuildRoute: bos, handleClearRoute: bos, handleToggleOrderPaid: bos,
    trackView: bos, openConfirm: bos, toast: vi.fn(), setActiveTab: bos, setSelectedLead: bos, setIsAddingOrder: bos,
    logAuditAction: sozBos,
    ...ek,
  };
  const sonuc = render(<OrdersPage {...ozellikler} />);
  return { ...sonuc, handleMikroFatura, handleMikroFaturaSonuc };
}
const dugmeler = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>('[data-mikro-fatura-dugmesi]')];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  localStorage.clear();
  window.history.replaceState(null, '', '/orders');
  useAppStore.setState({ companyId: 'kiraci-1' });
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('B1 / B9 (D6, D8) — ayrıntı CANLI kayıttan; belirsiz siparişte düğme yok, uyarı + iki seçenek', { timeout: 30_000 }, () => {
  it('`selectedOrder` işaretsiz (bayat), `orders` satırı `belirsiz` → kesim düğmesi YOK; uyarı ve iki seçenek VAR', async () => {
    const { container } = ciz(siparis(), [siparis(isaret('belirsiz'))]);
    await act(async () => {});
    expect(dugmeler(container)).toEqual([]);
    const uyari = container.querySelector<HTMLElement>('[data-fatura-sonucu="sip-1"]');
    if (!uyari) throw new Error('uyarı çizilmedi');
    expect(uyari.textContent).toContain('Fatura sonucu bilinmiyor');
    expect(uyari.textContent).toContain('satis@example.test');
    expect(within(uyari).getByRole('button', { name: 'Mikro\'da var' })).toBeTruthy();
    expect(within(uyari).getByRole('button', { name: 'Mikro\'da yok, yeniden gönderilebilir' })).toBeTruthy();
  });

  it('bayat `gonderiliyor` de çözülebilir (eşik sabitten); taze `gonderiliyor` → düğme ve seçenek YOK, «Fatura gönderiliyor» rozeti', async () => {
    const bayat = ciz(siparis(), [siparis(isaret('gonderiliyor', {}, Date.now() - FATURA_GONDERIM_BAYATLIK_MS - 1_000))]);
    await act(async () => {});
    expect(bayat.container.querySelector('[data-fatura-sonucu]')).not.toBeNull();
    bayat.unmount();
    const taze = ciz(siparis(), [siparis(isaret('gonderiliyor'))]);
    await act(async () => {});
    expect(dugmeler(taze.container)).toEqual([]);
    expect(taze.container.querySelector('[data-fatura-sonucu]')).toBeNull();
    expect(taze.container.querySelector('[data-fatura-durumu="sip-1"]')?.textContent).toBe('Fatura gönderiliyor');
  });

  it('seçenekler App işleyicisini çağırır: «Mikro\'da yok» numarasız, «Mikro\'da var» girilen numarayla — CANLI siparişle', async () => {
    const canli = siparis(isaret('belirsiz'));
    const { container, handleMikroFaturaSonuc } = ciz(siparis(), [canli]);
    await act(async () => {});
    const uyari = container.querySelector<HTMLElement>('[data-fatura-sonucu="sip-1"]');
    if (!uyari) throw new Error('uyarı çizilmedi');
    fireEvent.click(within(uyari).getByRole('button', { name: 'Mikro\'da yok, yeniden gönderilebilir' }));
    expect(handleMikroFaturaSonuc).toHaveBeenLastCalledWith(canli, 'mikrodaYok', undefined);
    fireEvent.change(within(uyari).getByLabelText('Mikro fatura numarası (isteğe bağlı)'), { target: { value: '  CTP2026000000777 ' } });
    fireEvent.click(within(uyari).getByRole('button', { name: 'Mikro\'da var' }));
    expect(handleMikroFaturaSonuc).toHaveBeenLastCalledWith(canli, 'mikrodaVar', 'CTP2026000000777');
    expect(handleMikroFaturaSonuc).toHaveBeenCalledTimes(2);
  });

  it('kesim / çözüm yetkisi yoksa (İ3) ne düğme ne seçenek çizilir', async () => {
    const r1 = ciz(siparis(), [siparis()], { mikroFaturaKesebilir: false });
    await act(async () => {});
    expect(dugmeler(r1.container)).toEqual([]);
    r1.unmount();
    const r2 = ciz(siparis(), [siparis(isaret('belirsiz'))], { mikroFaturaSonucuCozebilir: false });
    await act(async () => {});
    expect(r2.container.querySelector('[data-fatura-sonucu]')).toBeNull();
  });

  it('işaretsiz siparişte ayrıntı düğmesi çizilir ve işleyiciyi CANLI siparişle çağırır; uçuş kilidi sürerken pasif ve «Gönderiliyor…»', async () => {
    const canli = siparis({ notes: 'canlı' });
    const r = ciz(siparis(), [canli]);
    await act(async () => {});
    const [dugme] = dugmeler(r.container);
    if (!dugme) throw new Error('düğme yok');
    fireEvent.click(dugme);
    expect(r.handleMikroFatura).toHaveBeenCalledWith(canli);
    r.unmount();
    const k = ciz(siparis(), [siparis(isaret('gonderiliyor'))], { mikroFaturaGonderiliyor: { 'sip-1': true } });
    await act(async () => {});
    const [kilitli] = dugmeler(k.container);
    if (!kilitli) throw new Error('kilitliyken düğme kaybolmamalı');
    expect(kilitli.disabled).toBe(true);
    expect(kilitli.textContent).toContain('Gönderiliyor…');
  });
});

describe('B4 (D10) — düzenleme kilidi: tutar, KDV oranı, cari', { timeout: 30_000 }, () => {
  const ac = async (secili: Order, canli: Order) => {
    const r = ciz(secili, [canli]);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }));
    const pencere = screen.getByRole('heading', { name: 'Siparişi Düzenle' }).closest('div.fixed') as HTMLElement;
    const sayilar = [...pencere.querySelectorAll<HTMLInputElement>('input[type="number"][placeholder]')];
    return { r, pencere, tutar: sayilar[0], kdv: sayilar[1] };
  };
  const durumlar: Array<[string, Partial<Order>, boolean]> = [
    ['gonderiliyor', isaret('gonderiliyor'), true],
    ['numarasız gonderildi', isaret('gonderildi'), true],
    ['belirsiz', isaret('belirsiz'), true],
    ['reddedildi', isaret('reddedildi'), false],
    ['işaretsiz', {}, false],
  ];
  it.each(durumlar)('%s', async (_ad, ek, kilitli) => {
    const o = siparis(ek);
    const { r, pencere, tutar, kdv } = await ac(o, o);
    expect([tutar.disabled, kdv.disabled]).toEqual([kilitli, kilitli]);
    expect(pencere.textContent?.includes('Resmî belge kesilmiş — cari bağı değiştirilemez')).toBe(kilitli);
    expect(pencere.textContent?.includes('Resmî belge kesilmiş — tutar ve KDV oranı değiştirilemez.')).toBe(kilitli);
    r.unmount();
  });
  it('`selectedOrder` bayat (işaretsiz), canlı satır `belirsiz` → yine kilitli', async () => {
    const { tutar, kdv } = await ac(siparis(), siparis(isaret('belirsiz')));
    expect([tutar.disabled, kdv.disabled]).toEqual([true, true]);
  });
});

describe('B8 (D12) — liste rozetleri ve sarı «Mikro\'ya gönderilmedi» noktası', { timeout: 30_000 }, () => {
  /** Sarı nokta: başlığı «Mikro'ya gönderilmedi» olan rozet (tek sipariş çizildiği için sayfada varlığı yeter). */
  const sariNokta = (c: HTMLElement): boolean => c.querySelector('[title="Mikro\'ya gönderilmedi"]') !== null;
  it('işaretsiz faturalı sipariş: sarı nokta VAR, rozet yok; işaret varken nokta ÇIKMAZ, rozet metni çizilir', async () => {
    const r1 = ciz(null, [siparis()]);
    await act(async () => {});
    expect(sariNokta(r1.container)).toBe(true);
    expect(r1.container.querySelector('[data-fatura-durumu]')).toBeNull();
    r1.unmount();
    for (const [durum, metin] of [['gonderiliyor', 'Fatura gönderiliyor'], ['belirsiz', 'Fatura sonucu bilinmiyor'], ['gonderildi', 'Fatura kesildi (numara okunamadı)']] as const) {
      const r = ciz(null, [siparis(isaret(durum))]);
      await act(async () => {});
      expect(sariNokta(r.container), durum).toBe(false);
      expect(r.container.querySelector('[data-fatura-durumu="sip-1"]')?.textContent, durum).toBe(metin);
      expect(dugmeler(r.container), durum).toEqual([]);
      r.unmount();
    }
    const red = ciz(null, [siparis(isaret('reddedildi'))]);
    await act(async () => {});
    expect(red.container.querySelector('[data-fatura-durumu="sip-1"]')?.textContent).toBe('Mikro reddetti');
    expect(dugmeler(red.container)).toHaveLength(1);   // reddedilen yeniden gönderilebilir
  });

  it('liste düğmesi: uçuş kilidi sürerken pasif ve «Gönderiliyor…» (işaret yayınla `gonderiliyor` olsa da kaybolmaz)', async () => {
    const r = ciz(null, [siparis(isaret('gonderiliyor'))], { mikroFaturaGonderiliyor: { 'sip-1': true } });
    await act(async () => {});
    const [d] = dugmeler(r.container);
    if (!d) throw new Error('düğme yok');
    expect(d.disabled).toBe(true);
    expect(d.textContent).toContain('Gönderiliyor…');
  });
});
