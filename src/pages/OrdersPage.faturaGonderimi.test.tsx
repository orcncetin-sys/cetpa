/**
 * OrdersPage.faturaGonderimi.test.tsx — e-Fatura gönderim işaretinin SAYFADAKİ karşılığı, sayfa GERÇEKTEN çizilerek
 * (2026-10-17, şartname «e-Fatura çift kesim» § 7.4 B1, B4, B8 (sayfa kolu), B9 (sayfa kolu)).
 *
 * Saf kurallar `utils/siparisler/faturaDurumu.gonderim.test.ts`'te; kilit `belgeKilidi.test.ts`'te; App.tsx işleyicisi (onay
 * penceresi, uçuş kilidi, yanıt yaması) GERÇEK App'te `components/MikroFatura.uygulama.test.tsx`'te. Burada sınanan: ayrıntı
 * ve liste CANLI kayıttan (`orders`) çizilir — bayat `selectedOrder` kopyası işaretsiz olsa da (D8); düzenleme kilidi aynı
 * yüklemden (D10); rozetler ve sarı «gönderilmedi» noktası (D12); belirsiz siparişte iki seçenek ve doğru çağrı (D6).
 *
 * ETTN (şartname «fatura gövde + gece MF» § 9.B B5 / B6, 2026-10-19): «Mikro'da var»ın isteğe bağlı ETTN girdisi (imza
 * `onKarar(karar, { numara?, ettn? })`, geçersizde PASİF + satır içi hata, gönderilen ANAHTAR); «ETTN ekle» bileşeninin AYRI
 * bağlantı koşulu (`gonderildi` + geçerli ETTN yok + kapı; `hasInvoice` okunmaz) ve ETTN rozeti. VAKA TABLOSU `test/ettnVakalari`:
 * aynı tablo uçta (`server/faturaCiftKesim.zincir.test` — «VAKA TABLOSU») ve sunucunun «ETTN var mı» kararında
 * (`server/mikro/faturaGonderimi.ettn.test`) koşar; burada düğme yüklemleri tablonun `anahtar` sütununa karşı sınanır — uç da
 * AYNI sütuna karşı sınandığı için sonuçlar birebirdir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import OrdersPage from './OrdersPage';
import { translations } from '../translations';
import { useAppStore } from '../store/appStore';
import { FATURA_GONDERIM_BAYATLIK_MS } from '../lib/faturaGonderimi';
import { ETTN_VAKALARI } from '../test/ettnVakalari';
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
  const handleMikroFaturaEttnEkle = vi.fn<Props['handleMikroFaturaEttnEkle']>(() => Promise.resolve());
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
    handleMikroFatura, handleMikroFaturaSonuc, handleMikroFaturaEttnEkle, mikroFaturaGonderiliyor: {}, mikroFaturaKesebilir: true, mikroFaturaSonucuCozebilir: true,
    handleEIrsaliye: sozBos, eIrsaliyeGonderiliyor: {}, handleIyzicoPaymentLink: sozBos,
    setRouteStops: bos, p554Bins: [], handleBuildRoute: bos, handleClearRoute: bos, handleToggleOrderPaid: bos,
    trackView: bos, openConfirm: bos, toast: vi.fn(), setActiveTab: bos, setSelectedLead: bos, setIsAddingOrder: bos,
    logAuditAction: sozBos,
    ...ek,
  };
  const sonuc = render(<OrdersPage {...ozellikler} />);
  return { ...sonuc, handleMikroFatura, handleMikroFaturaSonuc, handleMikroFaturaEttnEkle };
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
    expect(handleMikroFaturaSonuc).toHaveBeenLastCalledWith(canli, 'mikrodaVar', { numara: 'CTP2026000000777' });
    expect(handleMikroFaturaSonuc).toHaveBeenCalledTimes(2);
  });

  it('LB (2026-10-19, «takip kodu + LUCA reddi») — LUCA\'ya Cetpa\'dan aktarılmış siparişte (`lucaSynced` / `lucaFaturaNo`) kesim düğmesi ÇİZİLMEZ (sunucu 400 `luca-gonderildi`)', async () => {
    for (const ek of [{ lucaSynced: true }, { lucaFaturaNo: 'LF-2026-0001' }] as Partial<Order>[]) {
      const r = ciz(siparis(), [siparis(ek)]);
      await act(async () => {});
      expect(dugmeler(r.container), JSON.stringify(ek)).toEqual([]);
      r.unmount();
    }
    const acik = ciz(siparis(), [siparis({ lucaSynced: false, lucaFaturaNo: '  ' })]);
    await act(async () => {});
    expect(dugmeler(acik.container).length).toBeGreaterThan(0);
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

// ── § 9.B B5 / B6 — ETTN ──────────────────────────────────────────────────────────────────────────────────────────────────────
const ETTN = 'abcdef12-3456-7890-abcd-ef1234567890';
const SIFIR = '00000000-0000-0000-0000-000000000000';
const uyariKutusu = (c: HTMLElement): HTMLElement => {
  const u = c.querySelector<HTMLElement>('[data-fatura-sonucu="sip-1"]');
  if (!u) throw new Error('D6 uyarısı çizilmedi');
  return u;
};
const ettnKutusu = (c: HTMLElement): HTMLElement | null => c.querySelector<HTMLElement>('[data-fatura-ettn-ekle="sip-1"]');
const ettnEkleDugmesi = (c: HTMLElement): HTMLButtonElement => {
  const d = c.querySelector<HTMLButtonElement>('[data-fatura-ettn-ekle-dugmesi="sip-1"]');
  if (!d) throw new Error('«ETTN ekle» düğmesi yok');
  return d;
};

describe('§ 9.B B5 — «Mikro\'da var»ın ETTN girdisi: imza `onKarar(karar, { numara?, ettn? })`, ANAHTAR gider, geçersizde PASİF', { timeout: 30_000 }, () => {
  it('yardım metni ve `maxLength` 38; ETTN\'li çağrı: süslü parantezli BÜYÜK harfli geçerli GUID → KÜÇÜK harfli anahtar gider (numarayla birlikte)', async () => {
    const canli = siparis(isaret('belirsiz'));
    const { container, handleMikroFaturaSonuc } = ciz(siparis(), [canli]);
    await act(async () => {});
    const u = uyariKutusu(container);
    const girdi = within(u).getByLabelText<HTMLInputElement>('Mikro ETTN (isteğe bağlı)');
    expect(girdi.maxLength).toBe(38);
    expect(u.textContent).toContain('Mikro\'da faturanın ETTN\'si (e-Fatura ekranında)');
    fireEvent.change(within(u).getByLabelText('Mikro fatura numarası (isteğe bağlı)'), { target: { value: ' CTP2026000000778 ' } });
    fireEvent.change(girdi, { target: { value: `{${ETTN.toLocaleUpperCase('tr-TR')}}` } });
    expect(u.querySelector('[data-ettn-hatasi]')).toBeNull();
    fireEvent.click(within(u).getByRole('button', { name: 'Mikro\'da var' }));
    expect(handleMikroFaturaSonuc).toHaveBeenLastCalledWith(canli, 'mikrodaVar', { numara: 'CTP2026000000778', ettn: ETTN });
  });

  it('ETTN yalnız (numarasız) → `{ ettn }`; ikisi de boş → `{}`; «Mikro\'da yok» AYNEN `onKarar(\'mikrodaYok\')` (ek yok)', async () => {
    const canli = siparis(isaret('belirsiz'));
    const { container, handleMikroFaturaSonuc } = ciz(siparis(), [canli]);
    await act(async () => {});
    const u = uyariKutusu(container);
    const varDugmesi = within(u).getByRole('button', { name: 'Mikro\'da var' });
    fireEvent.click(varDugmesi);
    expect(handleMikroFaturaSonuc).toHaveBeenLastCalledWith(canli, 'mikrodaVar', {});
    fireEvent.change(within(u).getByLabelText('Mikro ETTN (isteğe bağlı)'), { target: { value: ETTN } });
    fireEvent.click(varDugmesi);
    expect(handleMikroFaturaSonuc).toHaveBeenLastCalledWith(canli, 'mikrodaVar', { ettn: ETTN });
    fireEvent.click(within(u).getByRole('button', { name: 'Mikro\'da yok, yeniden gönderilebilir' }));
    expect(handleMikroFaturaSonuc).toHaveBeenLastCalledWith(canli, 'mikrodaYok', undefined);
  });

  it('geçersiz ETTN (sıfır GUID) → «Mikro\'da var» `disabled`, `role="alert"` satır içi hata, tıklama çağırmaz; düzeltilince etkin', async () => {
    const canli = siparis(isaret('belirsiz'));
    const { container, handleMikroFaturaSonuc } = ciz(siparis(), [canli]);
    await act(async () => {});
    const u = uyariKutusu(container);
    const girdi = within(u).getByLabelText<HTMLInputElement>('Mikro ETTN (isteğe bağlı)');
    fireEvent.change(girdi, { target: { value: SIFIR } });
    const varDugmesi = within(u).getByRole<HTMLButtonElement>('button', { name: 'Mikro\'da var' });
    expect(varDugmesi.disabled).toBe(true);
    const hata = u.querySelector<HTMLElement>('[data-ettn-hatasi="sip-1"]');
    expect(hata?.getAttribute('role')).toBe('alert');
    expect(hata?.textContent).toBe('ETTN geçersiz: Mikro\'da e-Fatura ekranındaki 36 karakterlik ETTN\'yi girin (sıfır ETTN kabul edilmez).');
    expect(girdi.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(varDugmesi);
    expect(handleMikroFaturaSonuc).not.toHaveBeenCalled();
    // «Mikro'da yok» ETTN'den etkilenmez (o kararda ETTN verilmez).
    expect(within(u).getByRole<HTMLButtonElement>('button', { name: 'Mikro\'da yok, yeniden gönderilebilir' }).disabled).toBe(false);
    fireEvent.change(girdi, { target: { value: ETTN } });
    expect(varDugmesi.disabled).toBe(false);
    expect(u.querySelector('[data-ettn-hatasi]')).toBeNull();
  });

  it('VAKA TABLOSU — «Mikro\'da var» düğme yüklemi uçla birebir: boş / boşluk → ETTN\'siz karar; geçerli → anahtar; geçersiz → PASİF (uç 400)', async () => {
    const canli = siparis(isaret('belirsiz'));
    const { container, handleMikroFaturaSonuc } = ciz(siparis(), [canli]);
    await act(async () => {});
    const u = uyariKutusu(container);
    const girdi = within(u).getByLabelText('Mikro ETTN (isteğe bağlı)');
    const varDugmesi = within(u).getByRole<HTMLButtonElement>('button', { name: 'Mikro\'da var' });
    for (const v of ETTN_VAKALARI) {
      handleMikroFaturaSonuc.mockClear();
      fireEvent.change(girdi, { target: { value: v.girdi } });
      const kabul = v.bos === true || v.anahtar !== '';
      expect(varDugmesi.disabled, v.ad).toBe(!kabul);
      expect(u.querySelector('[data-ettn-hatasi]') !== null, v.ad).toBe(!kabul);
      fireEvent.click(varDugmesi);
      if (kabul) expect(handleMikroFaturaSonuc, v.ad).toHaveBeenCalledWith(canli, 'mikrodaVar', v.anahtar ? { ettn: v.anahtar } : {});
      else expect(handleMikroFaturaSonuc, v.ad).not.toHaveBeenCalled();
    }
  });
});

describe('§ 9.B B5 — «ETTN ekle» bileşeni: AYRI bağlantı koşulu, aynı ön sınama, ETTN rozeti', { timeout: 30_000 }, () => {
  it('`gonderildi` + ETTN yok → bileşen çizilir (D6 seçenekleri YOK); geçerli ETTN → `handleMikroFaturaEttnEkle(canlı, anahtar)`', async () => {
    const canli = siparis(isaret('gonderildi'));
    const { container, handleMikroFaturaEttnEkle } = ciz(siparis(), [canli]);
    await act(async () => {});
    expect(container.querySelector('[data-fatura-sonucu]')).toBeNull();
    const kutu = ettnKutusu(container);
    if (!kutu) throw new Error('«ETTN ekle» çizilmedi');
    expect(kutu.textContent).toContain('Mikro\'da faturanın ETTN\'si (e-Fatura ekranında)');
    expect(within(kutu).getByLabelText<HTMLInputElement>('Mikro ETTN').maxLength).toBe(38);
    expect(ettnEkleDugmesi(container).disabled).toBe(true);   // boşken pasif (burada ETTN zorunlu)
    fireEvent.change(within(kutu).getByLabelText('Mikro ETTN'), { target: { value: `  {${ETTN.toLocaleUpperCase('tr-TR')}} ` } });
    fireEvent.click(ettnEkleDugmesi(container));
    expect(handleMikroFaturaEttnEkle).toHaveBeenCalledWith(canli, ETTN);
    expect(container.querySelector('[data-fatura-ettn]')).toBeNull();   // rozet yok: ETTN henüz kayıtlı değil
  });

  it('VAKA TABLOSU — «ETTN ekle» düğme yüklemi uçla birebir: yalnız `anahtar` doluysa etkin ve ANAHTARLA çağırır; boş / geçersiz PASİF (uç 400)', async () => {
    const canli = siparis(isaret('gonderildi'));
    const { container, handleMikroFaturaEttnEkle } = ciz(siparis(), [canli]);
    await act(async () => {});
    const kutu = ettnKutusu(container);
    if (!kutu) throw new Error('«ETTN ekle» çizilmedi');
    const girdi = within(kutu).getByLabelText('Mikro ETTN');
    for (const v of ETTN_VAKALARI) {
      handleMikroFaturaEttnEkle.mockClear();
      fireEvent.change(girdi, { target: { value: v.girdi } });
      expect(ettnEkleDugmesi(container).disabled, v.ad).toBe(v.anahtar === '');
      // Satır içi hata yalnız DOLU ve geçersizde (boş girdi hata değil, yalnız pasif).
      expect(kutu.querySelector('[data-ettn-hatasi]') !== null, v.ad).toBe(v.bos !== true && v.anahtar === '');
      fireEvent.click(ettnEkleDugmesi(container));
      if (v.anahtar) expect(handleMikroFaturaEttnEkle, v.ad).toHaveBeenCalledWith(canli, v.anahtar);
      else expect(handleMikroFaturaEttnEkle, v.ad).not.toHaveBeenCalled();
    }
  });

  it('VAKA TABLOSU — bağlantı koşulu siparişteki `ettn` ile: geçerli anahtar varsa bileşen YOK ve rozet `ETTN: <anahtar>` (mono); yoksa bileşen var, rozet yok', async () => {
    for (const v of ETTN_VAKALARI) {
      const r = ciz(siparis(), [siparis({ ...isaret('gonderildi'), ettn: v.girdi })]);
      await act(async () => {});
      expect(ettnKutusu(r.container) !== null, v.ad).toBe(v.anahtar === '');
      const rozet = r.container.querySelector<HTMLElement>('[data-fatura-ettn="sip-1"]');
      if (v.anahtar) {
        expect(rozet?.textContent, v.ad).toBe(`ETTN: ${v.anahtar}`);
        expect(rozet?.querySelector('.font-mono')?.textContent, v.ad).toBe(v.anahtar);
      } else expect(rozet, v.ad).toBeNull();
      r.unmount();
    }
  });

  it('koşulun öteki kolları: `belirsiz` / taze `gonderiliyor` / `reddedildi` / işaretsiz (hasInvoice: true dâhil — A3) → YOK; `gonderildi` + `hasInvoice` yok → VAR; uçuş sürüyor → YOK; kapı yok → YOK', async () => {
    const yok: Array<[string, Partial<Order>, Partial<Props>]> = [
      ['belirsiz', isaret('belirsiz'), {}],
      ['taze gonderiliyor', isaret('gonderiliyor'), {}],
      ['reddedildi', isaret('reddedildi'), {}],
      ['işaretsiz hasInvoice', { hasInvoice: true }, {}],
      ['işaretsiz', {}, {}],
      ['uçuş sürüyor', isaret('gonderildi'), { mikroFaturaGonderiliyor: { 'sip-1': true } }],
      ['kapı yok', isaret('gonderildi'), { mikroFaturaSonucuCozebilir: false }],
      ['Mikro faturasından türemiş', { source: 'mikro-fatura', mikroFaturaNo: 'CTP1' } as Partial<Order>, {}],
    ];
    for (const [ad, ek, ozellik] of yok) {
      const r = ciz(siparis(), [siparis(ek)], ozellik);
      await act(async () => {});
      expect(ettnKutusu(r.container), ad).toBeNull();
      r.unmount();
    }
    const r = ciz(siparis({ hasInvoice: true, ettn: ETTN }), [siparis({ ...isaret('gonderildi', { numara: 'CTP2026000000900' }) })]);
    await act(async () => {});
    expect(ettnKutusu(r.container), '`selectedOrder` bayat (ETTN\'li) ama canlı satırda ETTN yok → canlıdan çizilir').not.toBeNull();
  });
});
