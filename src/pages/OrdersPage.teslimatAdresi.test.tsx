/**
 * OrdersPage.teslimatAdresi.test.tsx — «Siparişi Düzenle» penceresindeki teslimat üçlüsü (Ülke · İl / Şehir · Adres),
 * sipariş detayındaki tam adres ve kopya tohumu; sayfa GERÇEKTEN çizilerek (2026-10-10).
 *
 * Kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist (otomatik liste yap)».
 *
 * Saf yama kuralları `formKayit.test.ts`'te, bileşenler `ortak/IlSecici.test.tsx` + `ortak/UlkeSecici.test.tsx`'te,
 * kaynak bağlantısı `teslimatAdresi.cit.test.ts` + `onlineSiparisKaydi.degismez.test.ts`'te sabit. Burada sınanan, o
 * parçaların SAYFADA birlikte çalışmasıdır: kutular kayıttan doğru dolar, «Kaydet» veritabanına YALNIZ değişen alanı yazar
 * (adrese dokunulmayan eski kayda sessiz 'TR' yok — dokunulana AÇIKÇA yazılır; boşaltılan il açıkça `null`), mağaza
 * siparişinde üç alan da kilitlidir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import OrdersPage from './OrdersPage';
import { translations } from '../translations';
import { useAppStore } from '../store/appStore';
import { MAGAZA_KAYNAGI } from '../lib/magazaKaynagi';
import type { Order } from '../types';

// ── Düzenek: abonelik açılmaz, ağ çağrısı yapılmaz; `updateDoc` çağrıları kaydedilir ─────────────────────────────────
const { updateDoc } = vi.hoisted(() => ({
  updateDoc: vi.fn<(ref: { coll: string; id: string }, veri: Record<string, unknown>) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock('../lib/dbClient', async (asil) => ({
  ...(await asil<typeof import('../lib/dbClient')>()),
  onSnapshot: () => () => {},
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc,
}));
vi.mock('../services/authFetch', () => ({
  authFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }) })),
}));

/**
 * Ülke listesi `/geo/cities/_index.json` isteğinden gelir. Varsayılan: istek HİÇ yanıtlanmaz («yanıt gelene kadar» —
 * 'Türkiye' satırı kancadan bağımsız sabittir). Kanca BAŞARILI indeksi modül önbelleğine alır → indeksi dolduran test
 * dosyanın EN SONUNDADIR.
 */
const fetchTaklidi = vi.fn<(url: string) => Promise<unknown>>();

type Props = ComponentProps<typeof OrdersPage>;
const bos = () => {};
const sozBos = () => Promise.resolve();

const siparis = (ek: Partial<Order> = {}): Order =>
  ({ id: 'sip-1', customerName: 'Şirin Yapı', totalPrice: 1200, status: 'Pending', customerType: 'B2B', orderNumber: 'S-1', lineItems: [], ...ek });

function ciz(secili: Order, ek: Partial<Props> = {}) {
  const setSelectedOrder = vi.fn<Props['setSelectedOrder']>();
  const setSiparisTohumu = vi.fn<Props['setSiparisTohumu']>();
  const toast = vi.fn<Props['toast']>();
  const ozellikler: Props = {
    selectedOrder: secili, setSelectedOrder, lojistikTab: 'sevkiyat', setLojistikTab: bos,
    routeStops: [], isRouteOptimized: false, selectedDepot: 'eski_sanayi', setSelectedDepot: bos,
    DEPOTS: { eski_sanayi: { name: 'Eski Sanayi', lat: 36.9, lng: 30.7 }, havalimani: { name: 'Havalimanı', lat: 36.9, lng: 30.8 } },
    recurringOrders: [], hasFullAccess: () => true, siparisDetayiAcilabilir: true,
    currentLanguage: 'tr', currentT: translations.tr,
    orders: [secili], leads: [], inventory: [], exchangeRates: null, employees: [],
    userRole: 'Admin', user: { uid: 'uid-7', email: 'yonetici@ornek.com.tr', displayName: 'Yönetici' },
    kpiCurrency: 'TRY', setKpiCurrency: bos, activeTab: 'orders', darkMode: false,
    warehouses: [], vehicles: [], aracKonumlari: [], konumYazabilir: false, irsaliyeKesebilir: false, kullaniciUid: 'uid-7',
    locationStocks: [], shipments: [], setSiparisTohumu,
    handleMikroFatura: sozBos, handleEIrsaliye: sozBos, eIrsaliyeGonderiliyor: {}, handleIyzicoPaymentLink: sozBos,
    setRouteStops: bos, p554Bins: [], handleBuildRoute: bos, handleClearRoute: bos, handleToggleOrderPaid: bos,
    trackView: bos, openConfirm: bos, toast, setActiveTab: bos, setSelectedLead: bos, setIsAddingOrder: bos,
    logAuditAction: sozBos,
    ...ek,
  };
  const sonuc = render(<OrdersPage {...ozellikler} />);
  return { ...sonuc, setSelectedOrder, setSiparisTohumu, toast };
}

/** Sayfayı seçili siparişle çizer, açılıştaki eşzamansız işi bitirir ve «Düzenle» ile pencereyi açar. */
async function duzenlemeAc(secili: Order, ek: Partial<Props> = {}) {
  const sonuc = ciz(secili, ek);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }));
  return sonuc;
}
const pencere = () => screen.getByRole('heading', { name: 'Siparişi Düzenle' }).closest('div.fixed') as HTMLElement;
const grup = () => within(pencere()).getByRole('group', { name: 'Teslimat Adresi' });
const ulkeKutusu = () => within(grup()).getByLabelText('Ülke') as HTMLSelectElement | HTMLInputElement;
const ilKutusu = () => within(grup()).getByLabelText('İl / Şehir') as HTMLInputElement;
const adresKutusu = () => within(grup()).getByLabelText('Adres (ilçe, mahalle, sokak)') as HTMLInputElement;
const ilSec = (yazilan: string) => {
  fireEvent.focus(ilKutusu());
  fireEvent.change(ilKutusu(), { target: { value: yazilan } });
  fireEvent.keyDown(ilKutusu(), { key: 'Enter' });
};
/** «Kaydet»e basar ve veritabanına yazılan yamayı döndürür (`updatedAt` hariç). */
async function kaydet(): Promise<Record<string, unknown>> {
  fireEvent.click(within(pencere()).getByRole('button', { name: 'Kaydet' }));
  await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1));
  await act(async () => {});
  const [ref, veri] = updateDoc.mock.calls[0];
  expect(ref).toMatchObject({ coll: 'orders', id: 'sip-1' });
  const { updatedAt: _zaman, ...yama } = veri;
  return yama;
}
/** Kayıttan sonra ekrandaki siparişe uygulanan yerel durum (sayfa işlevsel güncelleyici verir). */
const yerelDurum = (setSelectedOrder: ReturnType<typeof vi.fn>, onceki: Order): Order => {
  const guncelleyici = setSelectedOrder.mock.calls.map(c => c[0]).filter((a): a is (o: Order | null) => Order | null => typeof a === 'function').at(-1);
  if (!guncelleyici) throw new Error('yerel durum güncellenmedi');
  const sonuc = guncelleyici(onceki);
  if (!sonuc) throw new Error('yerel durum boş');
  return sonuc;
};

beforeEach(() => {
  updateDoc.mockClear();
  fetchTaklidi.mockReset();
  fetchTaklidi.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchTaklidi);
  localStorage.clear();
  window.history.replaceState(null, '', '/orders');
  useAppStore.setState({ companyId: 'kiraci-1' });
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

// Süre sınırı geniş: sayfa büyük (ilk çizim yüzlerce ms) ve paket başka işlerle aynı anda koşarken yavaşlar.
describe('OrdersPage — sipariş detayı ve kopya: teslimat adresi', { timeout: 30_000 }, () => {
  it('detay TAM adresi gösterir: kalan + il (yurt içinde ülke yazılmaz); yurt dışında Türkçe ülke adı', async () => {
    const { unmount } = ciz(siparis({ shippingAddress: 'Kepez, Yenigün Mah. 1063 Sok. No:4', teslimatSehri: 'Antalya', teslimatUlke: 'TR' }));
    await act(async () => {});
    expect(screen.getByText('Kepez, Yenigün Mah. 1063 Sok. No:4, Antalya')).toBeTruthy();
    unmount();
    ciz(siparis({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE' }));
    await act(async () => {});
    expect(screen.getByText('Hauptstr. 5, Berlin, Almanya')).toBeTruthy();
  });

  it('adres kutusu boş, yalnız ili seçilmiş siparişte detay ili gösterir («--» değil)', async () => {
    ciz(siparis({ shippingAddress: '', teslimatSehri: 'Antalya', teslimatUlke: 'TR' }));
    await act(async () => {});
    const etiket = screen.getByText(translations.tr.shipping_address);
    expect(etiket.parentElement?.textContent).toBe(`${translations.tr.shipping_address}Antalya`);
  });

  it('«Klonla» tohumu ülke ve ili de taşır', async () => {
    const { setSiparisTohumu } = ciz(siparis({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Klonla' }));
    expect(setSiparisTohumu).toHaveBeenCalledTimes(1);
    expect(setSiparisTohumu.mock.calls[0][0]?.order).toMatchObject({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE' });
  });

  it('MAĞAZA siparişinin kopyasında `teslimatSehri` TAŞINMAZ («ilçe / il» 81 il listesinde yok); ülke taşınır', async () => {
    const { setSiparisTohumu } = ciz(siparis({ source: MAGAZA_KAYNAGI, shippingAddress: 'Ayşe Yılmaz, Atatürk Blv. 12, Çankaya / Ankara, 06100, Türkiye', teslimatSehri: 'Çankaya / Ankara', teslimatUlke: 'TR' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Klonla' }));
    const tohum = setSiparisTohumu.mock.calls[0][0]?.order ?? {};
    expect(tohum).not.toHaveProperty('teslimatSehri');
    expect(tohum).toMatchObject({ teslimatUlke: 'TR', shippingAddress: 'Ayşe Yılmaz, Atatürk Blv. 12, Çankaya / Ankara, 06100, Türkiye' });
  });
});

describe('OrdersPage — «Siparişi Düzenle»: Ülke · İl / Şehir · Adres', { timeout: 30_000 }, () => {
  it("ESKİ kayıt (ülke / il alanı yok): ülke 'Türkiye' GÖRÜNÜR, boş kalan yalnız il kutusu; adres metninden il AYIKLANMAZ", async () => {
    await duzenlemeAc(siparis({ shippingAddress: 'Kepez / Antalya' }));
    expect(ulkeKutusu().tagName).toBe('SELECT');
    expect(ulkeKutusu().value).toBe('TR');
    expect(ilKutusu().value).toBe('');
    expect(ilKutusu().getAttribute('role')).toBe('combobox');
    expect(adresKutusu().value).toBe('Kepez / Antalya');
  });

  it("eski kayıt dokunulmadan kaydedilince yamada `teslimatUlke` de `teslimatSehri` de YOK (sessiz 'TR' yazılmaz)", async () => {
    const onceki = siparis({ shippingAddress: 'Kepez / Antalya' });
    const { toast } = await duzenlemeAc(onceki);
    const yama = await kaydet();
    expect(yama).not.toHaveProperty('teslimatUlke');
    expect(yama).not.toHaveProperty('teslimatSehri');
    expect(toast).toHaveBeenCalledWith('Sipariş güncellendi.', 'success');
  });

  it("il SEÇİMİ → yamada `teslimatSehri: 'Antalya'` + alanı olmayan kayıtta `teslimatUlke: 'TR'` AÇIKÇA (adrese dokunuldu); ekrandaki sipariş de güncellenir", async () => {
    const onceki = siparis({ shippingAddress: 'Kepez, Yenigün Mah.' });
    const { setSelectedOrder } = await duzenlemeAc(onceki);
    ilSec('ant');
    expect(ilKutusu().value).toBe('Antalya');
    const yama = await kaydet();
    expect(yama.teslimatSehri).toBe('Antalya');
    expect(yama.teslimatUlke).toBe('TR');
    expect(yerelDurum(setSelectedOrder, onceki)).toMatchObject({ teslimatSehri: 'Antalya', teslimatUlke: 'TR', shippingAddress: 'Kepez, Yenigün Mah.' });
  });

  // İnceleme 2026-10-10 (gizlilik): kimliksiz takip ucu yapısal OLMAYAN kayıtta adresin son iki parçasını verir. Eski
  // kayıtta adres yeni etikete göre («ilçe, mahalle, sokak») yeniden yazılıp il boş bırakılınca ülke YAZILMAZSA kayıt
  // yapısal olmaz ve sokak / kapı / daire dışarı çıkar. Sayfa yama çağrısına önceki adresi GERÇEKTEN veriyor mu — burada.
  it("ESKİ kayıtta yalnız ADRES metni değişti, il boş → yamada `teslimatUlke: 'TR'` AÇIKÇA yazılır (kayıt takip ucunda yapısal olur)", async () => {
    const onceki = siparis({ shippingAddress: 'Yenigün Mah. 1063 Sok. No:4 D:7, Muratpaşa, Antalya' });
    const { setSelectedOrder } = await duzenlemeAc(onceki);
    fireEvent.change(adresKutusu(), { target: { value: 'Muratpaşa, Yenigün Mah. 1063 Sok. No:4 D:7' } });
    expect(ilKutusu().value).toBe('');
    const yama = await kaydet();
    expect(yama).toMatchObject({ shippingAddress: 'Muratpaşa, Yenigün Mah. 1063 Sok. No:4 D:7', teslimatUlke: 'TR' });
    expect(yama).not.toHaveProperty('teslimatSehri');
    expect(yerelDurum(setSelectedOrder, onceki).teslimatUlke).toBe('TR');
  });

  it('il BOŞALTMA (önceki dolu) → yamada açıkça `null`; ekrandaki siparişte alan YOK (`null` taşınmaz)', async () => {
    const onceki = siparis({ shippingAddress: 'Kepez', teslimatSehri: 'Antalya', teslimatUlke: 'TR' });
    const { setSelectedOrder } = await duzenlemeAc(onceki);
    expect(ilKutusu().value).toBe('Antalya');
    fireEvent.focus(ilKutusu());
    fireEvent.change(ilKutusu(), { target: { value: '' } });
    fireEvent.blur(ilKutusu());
    expect(ilKutusu().value).toBe('');
    const yama = await kaydet();
    expect(yama).toHaveProperty('teslimatSehri', null);
    expect(yama).not.toHaveProperty('teslimatUlke');
    const yerel = yerelDurum(setSelectedOrder, onceki);
    expect(yerel.teslimatSehri).toBeUndefined();
    expect(yerel.teslimatUlke).toBe('TR');
  });

  it('kayıtta il `null` (önceki boşaltma) ve kullanıcı dokunmadı → kutu boş açılır, yamada alan YOK, pencere çökmez', async () => {
    await duzenlemeAc(siparis({ shippingAddress: 'Kepez', teslimatSehri: null as unknown as string, teslimatUlke: 'TR' }));
    expect(ilKutusu().value).toBe('');
    const yama = await kaydet();
    expect(yama).not.toHaveProperty('teslimatSehri');
    expect(yama).not.toHaveProperty('teslimatUlke');
  });

  it('yurt dışı kayıt: ülke indeks gelmeden de görünür, şehir serbest metin; şehir değişince yalnız şehir yazılır', async () => {
    await duzenlemeAc(siparis({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE' }));
    expect(ulkeKutusu().value).toBe('DE');
    expect(ilKutusu().value).toBe('Berlin');
    expect(ilKutusu().hasAttribute('aria-expanded')).toBe(false);     // açılır il listesi değil
    fireEvent.change(ilKutusu(), { target: { value: 'Hamburg' } });
    const yama = await kaydet();
    expect(yama.teslimatSehri).toBe('Hamburg');
    expect(yama).not.toHaveProperty('teslimatUlke');
  });

  it('müşteri alanına yazmak adres / il / ülkeye DOKUNMAZ (bu pencerede oto-adres yok)', async () => {
    await duzenlemeAc(siparis({ shippingAddress: 'Kepez', teslimatSehri: 'Antalya', teslimatUlke: 'TR' }));
    fireEvent.change(within(pencere()).getByPlaceholderText('Müşteri adı — listeden seçin'), { target: { value: 'Başka Müşteri' } });
    expect(adresKutusu().value).toBe('Kepez');
    expect(ilKutusu().value).toBe('Antalya');
    expect(ulkeKutusu().value).toBe('TR');
    const yama = await kaydet();
    expect(yama.customerName).toBe('Başka Müşteri');
    expect(yama).not.toHaveProperty('teslimatSehri');
    expect(yama).not.toHaveProperty('teslimatUlke');
  });
});

describe('OrdersPage — «Siparişi Düzenle»: MAĞAZA KİLİDİ', { timeout: 30_000 }, () => {
  const MAGAZA_SIPARISI = siparis({
    source: MAGAZA_KAYNAGI, shippingAddress: 'Ayşe Yılmaz, Atatürk Blv. 12, Çankaya / Ankara, 06100', teslimatSehri: 'Çankaya / Ankara',
  });

  it('üç alan da SALT OKUNUR: il «ilçe / il» metnini aynen gösterir; ülke kayıtta yoksa «—» (Türkiye varsayılmaz)', async () => {
    await duzenlemeAc(MAGAZA_SIPARISI);
    expect(ulkeKutusu().tagName).toBe('INPUT');                       // seçici değil
    expect(ulkeKutusu().value).toBe('—');
    expect((ulkeKutusu() as HTMLInputElement).readOnly).toBe(true);
    expect(ilKutusu().value).toBe('Çankaya / Ankara');
    expect(ilKutusu().readOnly).toBe(true);
    expect(ilKutusu().hasAttribute('role')).toBe(false);              // açılır liste değil
    expect(adresKutusu().value).toBe('Ayşe Yılmaz, Atatürk Blv. 12, Çankaya / Ankara, 06100');
    expect(adresKutusu().readOnly).toBe(true);
    fireEvent.focus(ilKutusu());
    expect(within(pencere()).queryByRole('listbox')).toBeNull();
    expect(fetchTaklidi).not.toHaveBeenCalledWith('/geo/cities/_index.json');   // kilitli kayıtta ülke listesi istenmez
  });

  it('kayıtta ülke kodu varsa adıyla gösterilir', async () => {
    await duzenlemeAc({ ...MAGAZA_SIPARISI, teslimatUlke: 'DE' });
    expect(ulkeKutusu().value).toBe('Almanya');
  });

  it('kayıtta da kilitli: yamada adres / ülke / il ANAHTARI YOK', async () => {
    await duzenlemeAc({ ...MAGAZA_SIPARISI, teslimatUlke: 'DE' });
    const yama = await kaydet();
    for (const alan of ['customerName', 'shippingAddress', 'teslimatUlke', 'teslimatSehri', 'totalPrice']) expect(yama, alan).not.toHaveProperty(alan);
  });
});

// ── Buradan sonrası ülke indeksini DOLDURUR (kanca modül önbelleğine alır) — dosyanın SONUNDA kalmalı. ──
describe('OrdersPage — «Siparişi Düzenle»: ülke değişimi (indeks geldikten sonra)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    fetchTaklidi.mockImplementation(async url => {
      if (url === '/geo/cities/_index.json') return { ok: true, json: async () => ['DE', 'TR', 'US'] };
      throw new Error('ağ yok');   // şehir önerisi isteği başarısız: kutu öneri olmadan da yazılabilir
    });
  });
  const ulkeSec = async (kod: string) => {
    await waitFor(() => expect([...(ulkeKutusu() as HTMLSelectElement).options].map(o => o.value)).toContain('DE'));
    fireEvent.change(ulkeKutusu(), { target: { value: kod } });
    if (kod !== 'TR') await waitFor(() => expect(fetchTaklidi).toHaveBeenCalledWith(`/geo/cities/${kod}.json`));
  };

  it("ülke TR → DE ve önceki il dolu → il kutusu boşalır; yamada `teslimatUlke: 'DE'` + `teslimatSehri: null`", async () => {
    const onceki = siparis({ shippingAddress: 'Kepez', teslimatSehri: 'Antalya', teslimatUlke: 'TR' });
    const { setSelectedOrder } = await duzenlemeAc(onceki);
    await ulkeSec('DE');
    expect(ilKutusu().value).toBe('');
    expect(ilKutusu().placeholder).toBe('Şehir yazın');
    const yama = await kaydet();
    expect(yama).toMatchObject({ teslimatUlke: 'DE', teslimatSehri: null });
    const yerel = yerelDurum(setSelectedOrder, onceki);
    expect(yerel.teslimatUlke).toBe('DE');
    expect(yerel.teslimatSehri).toBeUndefined();
  });

  it("ESKİ kayıtta (ülke alanı yok) ülke DE seçilip şehir yazılınca ikisi de yazılır; TR'ye geri dönülürse ülke YAZILMAZ", async () => {
    const { unmount } = await duzenlemeAc(siparis({ shippingAddress: 'Hauptstr. 5' }));
    await ulkeSec('DE');
    fireEvent.change(ilKutusu(), { target: { value: 'Berlin' } });
    expect(await kaydet()).toMatchObject({ teslimatUlke: 'DE', teslimatSehri: 'Berlin' });
    unmount();
    updateDoc.mockClear();

    await duzenlemeAc(siparis({ shippingAddress: 'Kepez / Antalya' }));
    await ulkeSec('DE');
    await ulkeSec('TR');
    const yama = await kaydet();
    expect(yama).not.toHaveProperty('teslimatUlke');                  // etkin ülke değişmedi: eski kayda 'TR' yazılmaz
    expect(yama).not.toHaveProperty('teslimatSehri');
  });
});
