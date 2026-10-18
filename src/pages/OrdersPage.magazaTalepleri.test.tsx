/**
 * OrdersPage.magazaTalepleri.test.tsx — «Mağaza Talepleri» sekmesinin GERÇEK SAYFADA çizimi (dilim 1, 2026-10-08).
 *
 * `OrdersPage.magazaTalepleri.degismez.test.ts` bağlantıyı KAYNAKTA çitler; bu dosya aynı kuralları sayfayı gerçekten
 * çizerek sınar (yalnız `orders` listesi görünümü — detay ve Lojistik sekmesi bu dosyanın konusu değil):
 *   - üçüncü düğme yalnız yetkili role (Yönetici, Müdür, Satış) çizilir; yetkisiz rolde abonelik HİÇ açılmaz;
 *   - «magaza» seçilince sipariş gövdesi (KPI şeridi, tablo, arama, CSV, para birimi) ekrandan kalkar, talepler çizilir;
 *   - adresle açılış (`?kaynak=magaza`) yalnız yetkili rolde;
 *   - sekme rozeti iki sayı taşır: «görülmemiş» sekme açılınca kalkar, sonra gelen talep sayılır; «yeni» aşama sayısıdır.
 *
 * DİLİM 2a (şartname v6 § 7 «yazıldı ama bağlanmadı», 2026-10-10): aşama düğmesi, kalem teslim kutusu, «Yeniden gönder», arama
 * kutusu ve «Etiket basıldı» satırı GERÇEK sayfadan açılan yoldadır — düğmeye basınca istek `authFetch` ile doğru uca, doğru
 * gövdeyle gider (bileşen testi yalnız niteliğin çağrıldığını, servis testi yalnız işlevin isteğini görür; ikisinin sayfada
 * birbirine BAĞLI olduğunu bu dosya kanıtlar). BİLEREK DEĞİŞEN dilim 1 sabiti: rozet adı «N yeni talep» → «N görülmemiş talep»
 * + ayrı «N yeni talep» (aşama); sekme açılınca yalnız «görülmemiş» kalkar.
 *
 * DİLİM 2b (şartname v6 § 10.4 / § 10.8 «yazıldı ama bağlanmadı» + V24, 2026-10-11): «Düzenle» formu, «Sil» / «Geri al» (yalnız
 * Yönetici), «Yeni talep (elle)», revize bildirimini «Yeniden gönder», iki tablo ve dört süzgeç düğmesi GERÇEK sayfadan açılan
 * yoldadır: istekler doğru uca (`…/icerik`, `…/sil`, kök, `…/bildirim-gonder?tur=revize`) doğru gövdeyle gider; teyit kaleminin
 * KDV varsayılanı sayfanın GERÇEK `inventory` kopyasından okunur (`magazaUrunKdvOrani` — taban stok kodu kuralı dâhil).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import OrdersPage from './OrdersPage';
import { translations } from '../translations';
import { useAppStore } from '../store/appStore';
import { APP_ROLES } from '../lib/rbac';
import { authFetch } from '../services/authFetch';
import { _registerConfirmListener, _resolveConfirm, type ConfirmOpts } from '../lib/confirm';
import type { Order } from '../types';

// ── Akış düzeneği: sayfanın ve kancaların açtığı abonelikler kaydedilir, ağ çağrısı yapılmaz ──────────────────────────
interface Abonelik { ad: string; next: (s: unknown) => void; kapandi: boolean }
const abonelikler: Abonelik[] = [];
vi.mock('../lib/dbClient', async (asil) => ({
  ...(await asil<typeof import('../lib/dbClient')>()),
  onSnapshot: (hedef: { coll?: string; path?: string }, next: (s: unknown) => void) => {
    const a: Abonelik = { ad: hedef.coll ?? hedef.path ?? '?', next, kapandi: false };
    abonelikler.push(a);
    return () => { a.kapandi = true; };
  },
  setDoc: vi.fn(() => Promise.resolve()),
}));
vi.mock('../services/authFetch', () => ({
  authFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }) })),
}));

type Props = ComponentProps<typeof OrdersPage>;
const bos = () => {};
const sozBos = () => Promise.resolve();

const siparis = (id: string, ek: Partial<Order> = {}): Order =>
  ({ id, customerName: `Müşteri ${id}`, totalPrice: 1000, status: 'Pending', customerType: 'B2B', orderNumber: `S-${id}`, lineItems: [], ...ek });

const ozellikler = (ek: Partial<Props> = {}): Props => ({
  selectedOrder: null, setSelectedOrder: bos, lojistikTab: 'sevkiyat', setLojistikTab: bos,
  routeStops: [], isRouteOptimized: false, selectedDepot: 'eski_sanayi', setSelectedDepot: bos,
  DEPOTS: { eski_sanayi: { name: 'Eski Sanayi', lat: 36.9, lng: 30.7 }, havalimani: { name: 'Havalimanı', lat: 36.9, lng: 30.8 } },
  recurringOrders: [], hasFullAccess: () => true, siparisDetayiAcilabilir: true,
  currentLanguage: 'tr', currentT: translations.tr,
  orders: [siparis('1'), siparis('2', { status: 'Delivered' }), siparis('3', { status: 'Processing' })],
  leads: [], inventory: [], exchangeRates: null, employees: [],
  userRole: 'Admin', user: { uid: 'uid-7', email: 'yonetici@ornek.com.tr', displayName: 'Yönetici' },
  kpiCurrency: 'TRY', setKpiCurrency: bos, activeTab: 'orders', darkMode: false,
  warehouses: [], vehicles: [], aracKonumlari: [], konumYazabilir: false, irsaliyeKesebilir: false, kullaniciUid: 'uid-7',
  locationStocks: [], shipments: [], setSiparisTohumu: bos,
  handleMikroFatura: sozBos, handleMikroFaturaSonuc: sozBos, handleMikroFaturaEttnEkle: sozBos, mikroFaturaGonderiliyor: {}, mikroFaturaKesebilir: true, mikroFaturaSonucuCozebilir: true,
    handleEIrsaliye: sozBos, eIrsaliyeGonderiliyor: {}, handleIyzicoPaymentLink: sozBos,
  setRouteStops: bos, p554Bins: [], handleBuildRoute: bos, handleClearRoute: bos, handleToggleOrderPaid: bos,
  trackView: bos, openConfirm: bos, toast: bos, setActiveTab: bos, setSelectedLead: bos, setIsAddingOrder: bos,
  logAuditAction: sozBos,
  ...ek,
});

const magazaAkisi = () => abonelikler.filter(a => a.ad === 'magazaTalepleri');
const talepDokumani = (no: string, olusturma: string, ek: Record<string, unknown> = {}) => ({
  companyId: 'kiraci-1', talepNo: no, durum: 'yeni', olusturma, istemciTarihi: null,
  musteri: { ad: 'Şükrü Çağlayan', firma: 'Çağlayan İnşaat', telefon: '0532 111 22 33', eposta: '', il: 'İzmir', adres: '', vergi: '' },
  telefonSon10: '5321112233', not: '', kalemler: [{ id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false }],
  talepEdilen: { araToplam: 409.98, kdv: 82, toplam: 491.98 }, fiyatiSorulacakVar: false, bildirim: { durum: 'gitti', zaman: olusturma },
  ...ek,
});
const talepGonder = (...d: Array<{ id: string; veri: unknown }>) =>
  act(() => { for (const a of magazaAkisi()) if (!a.kapandi) a.next({ docs: d.map(x => ({ id: x.id, data: () => x.veri })) }); });

const dugme = (ad: RegExp | string) => screen.queryByRole('button', { name: ad });
/** Düğmeyi bulup tıklar; düğme yoksa testi adıyla kırar. */
const tikla = (ad: RegExp | string): void => {
  const d = dugme(ad);
  if (d === null) throw new Error(`düğme ekranda yok: ${String(ad)}`);
  fireEvent.click(d);
};
/** Sayfayı çizer ve açılıştaki eşzamansız işi (Mikro alacak sorgusu) bitirir — sonraki durum güncellemesi test dışına taşmasın. */
async function sayfaCiz(ek: Partial<Props> = {}) {
  const sonuc = render(<OrdersPage {...ozellikler(ek)} />);
  await act(async () => {});
  return sonuc;
}
const MAGAZA = /^Mağaza Talepleri/;

// ── Dilim 2a: mağaza talebi yazma uçlarına giden istekler ──
const sahteIstek = vi.mocked(authFetch);
const VARSAYILAN_YANIT = () => Promise.resolve(new Response('{"success":false}', { status: 200 }));
/** Mağaza talebi uçlarına (2b: kök uç — elle talep — dâhil) verilen yanıt (her çağrıya yeni nesne); sayfanın öteki istekleri varsayılan yanıtı alır. */
const magazaYaniti = (status: number, govde: unknown): void => {
  sahteIstek.mockImplementation(adres => (String(adres).startsWith('/api/magaza-talepleri')
    ? Promise.resolve(new Response(JSON.stringify(govde), { status }))
    : VARSAYILAN_YANIT()));
};
/** Mağaza talebi uçlarına giden istekler: [adres, yöntem, başlıklar, gövde]. */
const magazaIstekleri = () => sahteIstek.mock.calls
  .filter(c => String(c[0]).startsWith('/api/magaza-talepleri'))
  .map(c => ({ adres: String(c[0]), yontem: c[1]?.method, basliklar: c[1]?.headers, govde: JSON.parse(String(c[1]?.body)) as unknown }));
/** Tıklar ve isteğin sözünü (mikro görev) işletir. */
const tiklaBekle = async (oge: HTMLElement): Promise<void> => { await act(async () => { fireEvent.click(oge); }); };
/**
 * Sipariş gövdesi ekranda mı. İKİ tür işaret: sipariş VERİSİNE bağlı olanlar (KPI şeridi, tablo satırı) ve veriden BAĞIMSIZ
 * olanlar (dönem süzgeci, iade paneli, arama, CSV, para birimi). İkinci tür şart: «magaza»da sipariş listesi zaten boştur —
 * yalnız veriye bağlı işaretlere bakan test, gövde kapısı kaldırılsa da yeşil kalırdı.
 */
const siparisGovdesi = () => ({
  kpi: screen.queryByText('Teslimat Oranı') !== null,
  tablo: screen.queryAllByText('Müşteri 1').length > 0,
  donemSuzgeci: screen.queryByText('Dönem:') !== null,
  iadePaneli: screen.queryByText(/İade & Şikayet Yönetimi/) !== null,
  arama: screen.queryByPlaceholderText(translations.tr.search_orders) !== null,
  csv: dugme('CSV') !== null,
  paraBirimi: dugme('$') !== null,
});
const HEPSI = { kpi: true, tablo: true, donemSuzgeci: true, iadePaneli: true, arama: true, csv: true, paraBirimi: true };
const HICBIRI = { kpi: false, tablo: false, donemSuzgeci: false, iadePaneli: false, arama: false, csv: false, paraBirimi: false };

beforeEach(() => {
  abonelikler.length = 0;
  localStorage.clear();
  window.history.replaceState(null, '', '/orders');
  useAppStore.setState({ companyId: 'kiraci-1' });
  sahteIstek.mockClear();
  sahteIstek.mockImplementation(VARSAYILAN_YANIT);
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

// Süre sınırı geniş: sayfa büyük (ilk çizim yüzlerce ms) ve paket başka işlerle aynı anda koşarken yavaşlar.
describe('OrdersPage — Mağaza Talepleri sekmesi (gerçek çizim)', { timeout: 30_000 }, () => {
  it('yetkili rolde (Yönetici) üçüncü düğme çizilir; varsayılan sekme Cetpa ve sipariş gövdesi ekranda', async () => {
    await sayfaCiz();
    expect(dugme('Cetpa Siparişleri')?.getAttribute('aria-pressed')).toBe('true');
    expect(dugme('Mikro Siparişleri')?.getAttribute('aria-pressed')).toBe('false');
    const magaza = dugme(MAGAZA);
    expect(magaza?.getAttribute('aria-pressed')).toBe('false');
    expect(magaza?.getAttribute('type')).toBe('button');
    expect(magaza?.className).toBe(dugme('Mikro Siparişleri')?.className);   // seçili olmayan iki düğme AYNI sınıf dizgisi
    expect(siparisGovdesi()).toEqual(HEPSI);
    expect(magazaAkisi()).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Mağaza Talepleri' })).toBeNull();
  });

  it('görenler TAM OLARAK Yönetici, Müdür, Satış: diğer her rolde düğme YOK ve abonelik HİÇ açılmaz', async () => {
    // Sayfa BİR kez (yetkisiz rolle) kurulur, sonra rol değiştirilir: 14 ayrı kurulum bu testi paketin en yavaşı yapardı.
    const roller = ['Logistics', ...APP_ROLES.filter(r => r !== 'Logistics'), 'Warehouse', ''];
    expect(roller).toHaveLength(APP_ROLES.length + 2);
    const { rerender } = await sayfaCiz({ userRole: roller[0] });
    expect(abonelikler.length).toBeGreaterThan(0);     // sayfanın öteki abonelikleri açıldı — düzenek abonelikleri görüyor
    expect(magazaAkisi()).toHaveLength(0);             // yetkisiz rolle KURULUŞTA mağaza aboneliği hiç açılmadı
    const gorenler: string[] = [];
    for (const rol of roller) {
      rerender(<OrdersPage {...ozellikler({ userRole: rol })} />);
      const dugmeVar = dugme(MAGAZA) !== null;
      // Düğme ile abonelik AYNI kapıdan: yetkili rolde tam bir AÇIK abonelik, yetkisizde hiç.
      expect(magazaAkisi().filter(a => !a.kapandi).length, `${rol}: açık abonelik`).toBe(dugmeVar ? 1 : 0);
      expect(dugme('Cetpa Siparişleri'), rol).not.toBeNull();   // sayfa çizildi (boş ekrana bakılmıyor)
      if (dugmeVar) gorenler.push(rol);
    }
    expect(gorenler.sort()).toEqual(['Admin', 'Manager', 'Sales']);
    // Yetkisiz rollerde abonelik AÇILMADI: toplam açılış sayısı = yetkili role her geçiş (ardışık yetkililer aboneliği paylaşır).
    expect(magazaAkisi().length).toBeLessThanOrEqual(3);
  });

  it('«magaza» seçilince sipariş gövdesi ÇİZİLMEZ; talepler çizilir; geri dönünce gövde yeniden gelir', async () => {
    await sayfaCiz();
    talepGonder({ id: 'mt-1', veri: talepDokumani('T261008-AB12', '2026-10-08T09:00:00.000Z') });
    tikla(MAGAZA);

    expect(dugme(MAGAZA)?.getAttribute('aria-pressed')).toBe('true');
    expect(dugme('Cetpa Siparişleri')?.getAttribute('aria-pressed')).toBe('false');
    expect(siparisGovdesi()).toEqual(HICBIRI);
    const liste = screen.getByRole('region', { name: 'Mağaza Talepleri' });
    expect(within(liste).getByText('T261008-AB12')).toBeTruthy();
    expect(within(liste).getByText('₺491,98')).toBeTruthy();
    // Talep sipariş DEĞİLDİR: «yeni sipariş» düğmesi kalır ama sipariş listesi öğeleri yok.
    expect(dugme(translations.tr.new_order)).not.toBeNull();

    tikla('Mikro Siparişleri');
    expect(screen.queryByRole('region', { name: 'Mağaza Talepleri' })).toBeNull();
    // Mikro sekmesinde sipariş gövdesi GERİ gelir (kapı yalnız «magaza»yı kapatır); Mikro listesi bu düzenekte boş olduğu
    // için veriye bağlı iki işaret yok — Cetpa siparişleri Mikro sekmesine sızmadı.
    expect(siparisGovdesi()).toEqual({ ...HEPSI, kpi: false, tablo: false });

    tikla('Cetpa Siparişleri');
    expect(siparisGovdesi()).toEqual(HEPSI);
  });

  it('adresle açılış: `?kaynak=magaza` + yetkili rol → sekme «magaza»; yetkisiz rolde Cetpa ve abonelik yok', async () => {
    window.history.replaceState(null, '', '/orders?kaynak=magaza');
    const { unmount } = await sayfaCiz({ userRole: 'Sales' });
    expect(dugme(MAGAZA)?.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region', { name: 'Mağaza Talepleri' }).textContent).toContain('Yükleniyor...');
    expect(siparisGovdesi()).toEqual(HICBIRI);
    expect(window.location.pathname).toBe('/orders');
    unmount();

    abonelikler.length = 0;
    await sayfaCiz({ userRole: 'Logistics' });
    expect(dugme(MAGAZA)).toBeNull();
    expect(dugme('Cetpa Siparişleri')?.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Mağaza Talepleri' })).toBeNull();
    expect(siparisGovdesi()).toEqual(HEPSI);
    expect(magazaAkisi()).toHaveLength(0);
  });

  it('yetki sekme AÇIKKEN düşerse «magaza» seçili kalmaz: Cetpa\'ya döner, abonelik kapanır', async () => {
    const { rerender } = await sayfaCiz({ userRole: 'Manager' });
    talepGonder({ id: 'mt-1', veri: talepDokumani('T261008-AB12', '2026-10-08T09:00:00.000Z') });
    tikla(MAGAZA);
    expect(screen.getByRole('region', { name: 'Mağaza Talepleri' })).toBeTruthy();

    rerender(<OrdersPage {...ozellikler({ userRole: 'Accounting' })} />);
    expect(dugme(MAGAZA)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mağaza Talepleri' })).toBeNull();
    expect(screen.queryByText('T261008-AB12')).toBeNull();
    expect(dugme('Cetpa Siparişleri')?.getAttribute('aria-pressed')).toBe('true');
    expect(siparisGovdesi()).toEqual(HEPSI);
    expect(magazaAkisi().every(a => a.kapandi)).toBe(true);
  });

  it('sekme rozeti İKİ sayı: «görülmemiş» düğmede sayılır → sekme açılınca kalkar → sonra gelen sayılır (anahtar kiracı + kullanıcı); «yeni» AŞAMA sayısıdır, görülünce kalkmaz', async () => {
    await sayfaCiz();
    const a = { id: 'mt-1', veri: talepDokumani('T261008-AAAA', '2026-10-08T08:00:00.000Z') };
    const b = { id: 'mt-2', veri: talepDokumani('T261008-BBBB', '2026-10-08T09:00:00.000Z', { durum: 'teyit' }) };
    talepGonder(a, b);
    // İki talep görülmedi; aşaması `yeni` olan BİR talep var (ikincisi teyit edilmiş).
    expect(dugme('Mağaza Talepleri 2 görülmemiş talep 1 yeni talep')).not.toBeNull();

    tikla(MAGAZA);
    expect(dugme('Mağaza Talepleri 1 yeni talep')).not.toBeNull();   // «görülmemiş» kalktı; «yeni» aşama sayısı kaldı
    expect(localStorage.getItem('cetpa:magazaTalepSonGorulen:kiraci-1:uid-7')).toBe(String(Date.parse('2026-10-08T09:00:00.000Z')));

    tikla('Cetpa Siparişleri');
    expect(dugme('Mağaza Talepleri 1 yeni talep')).not.toBeNull();
    talepGonder(a, b, { id: 'mt-3', veri: talepDokumani('T261008-CCCC', '2026-10-08T10:00:00.000Z') });
    expect(dugme('Mağaza Talepleri 1 görülmemiş talep 2 yeni talep')).not.toBeNull();

    // Aşaması `yeni` olan talep kalmayınca «yeni» sayısı da kalkar (panelde ilerletilen talep ERP rozetinden düşer).
    talepGonder({ id: 'mt-1', veri: { ...a.veri, durum: 'hazirlaniyor' } }, b, { id: 'mt-3', veri: talepDokumani('T261008-CCCC', '2026-10-08T10:00:00.000Z', { durum: 'iptal' }) });
    expect(dugme('Mağaza Talepleri 1 görülmemiş talep')).not.toBeNull();
  });

  it('sipariş detayı açıkken (liste ekranda değil) gelen talep «görüldü» SAYILMAZ', async () => {
    window.history.replaceState(null, '', '/orders?kaynak=magaza');
    const { rerender } = await sayfaCiz({ selectedOrder: siparis('9') });
    talepGonder({ id: 'mt-1', veri: talepDokumani('T261008-AAAA', '2026-10-08T08:00:00.000Z') });
    expect(localStorage.getItem('cetpa:magazaTalepSonGorulen:kiraci-1:uid-7')).toBeNull();

    rerender(<OrdersPage {...ozellikler({ selectedOrder: null })} />);   // detaydan listeye dönüldü — sekme «magaza»
    expect(screen.getByRole('region', { name: 'Mağaza Talepleri' })).toBeTruthy();
    expect(localStorage.getItem('cetpa:magazaTalepSonGorulen:kiraci-1:uid-7')).toBe(String(Date.parse('2026-10-08T08:00:00.000Z')));
  });
});

// ── Dilim 2a: «yazıldı ama bağlanmadı» — işlemler GERÇEK sayfadan uca gidiyor ───────────────────────────────────────
describe('OrdersPage — Mağaza Talepleri işlemleri gerçek sayfadan uca bağlı (dilim 2a)', { timeout: 30_000 }, () => {
  const ILK = '2026-10-08T09:00:00.000Z';
  const BASLIK = { 'Content-Type': 'application/json' };
  async function magazaSekmesi(...d: Array<{ id: string; veri: unknown }>) {
    await sayfaCiz({ userRole: 'Sales' });   // Satış da yetkilidir (sekmeyi görenler = işlem yapanlar)
    talepGonder(...d);
    tikla(MAGAZA);
    return screen.getByRole('region', { name: 'Mağaza Talepleri' });
  }

  it('«İlerlet» → TAM 1 istek: `POST /api/magaza-talepleri/:id/durum`, gövdede satırın sürümü; tünel başlığı yok', async () => {
    magazaYaniti(200, { ok: true });
    const liste = await magazaSekmesi({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { durumSurum: 4 }) });
    await tiklaBekle(within(liste).getByRole('button', { name: 'İlerlet: Teyit edildi' }));
    expect(magazaIstekleri()).toEqual([{ adres: '/api/magaza-talepleri/mt-1/durum', yontem: 'POST', basliklar: BASLIK, govde: { onceki: 'yeni', surum: 4, durum: 'teyit' } }]);
    // İyimser güncelleme YOK: rozet akış yeni belgeyi getirince değişir.
    expect(within(liste).getByText('Yeni')).toBeTruthy();
    talepGonder({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { durum: 'teyit', durumSurum: 5 }) });
    expect(within(liste).getByText('Teyit edildi')).toBeTruthy();
    expect(within(liste).getByRole('button', { name: 'İlerlet: Hazırlanıyor' })).toBeTruthy();
  });

  it('409 `gecis-yok`: sayfada «başka biri değiştirdi» uyarısı ve yanıttaki güncel aşama', async () => {
    magazaYaniti(409, { ok: false, kod: 'gecis-yok', durum: 'sevk' });
    const liste = await magazaSekmesi({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK) });
    await tiklaBekle(within(liste).getByRole('button', { name: 'İlerlet: Teyit edildi' }));
    expect(within(liste).getByRole('alert').textContent).toMatch(/^Başka biri değiştirdi/);
    expect(within(liste).getByText('Sevk edildi')).toBeTruthy();
  });

  it('detayda «teslim edildi» kutusu → TAM 1 istek: `POST …/kalem-teslim`, `kalemler: [\'b:0\']`; not kaydı aynı aşamayla `…/durum`', async () => {
    magazaYaniti(200, { ok: true });
    const liste = await magazaSekmesi({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { durum: 'sevk', durumSurum: 7 }) });
    fireEvent.click(within(liste).getByRole('button', { expanded: false }));
    await tiklaBekle(within(liste).getByRole('checkbox', { name: 'Teslim edildi: İç cephe boyası' }));
    expect(magazaIstekleri()).toEqual([{ adres: '/api/magaza-talepleri/mt-1/kalem-teslim', yontem: 'POST', basliklar: BASLIK, govde: { surum: 7, teslim: true, kalemler: ['b:0'] } }]);

    // Akış sürüm 8'i ve işareti getirdi; ardından not yazımı YENİ sürümle gider.
    talepGonder({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { durum: 'sevk', durumSurum: 8,
      kalemTeslim: { 'b:0': { durum: 'teslim', zaman: '2026-10-08T10:00:00.000Z', kim: { uid: 'uid-7', ad: 'Satış Personeli' } } } }) });
    expect((within(liste).getByRole('checkbox', { name: 'Teslim edildi: İç cephe boyası' }) as HTMLInputElement).checked).toBe(true);
    expect(within(liste).getByText('1 / 1 kalem teslim')).toBeTruthy();
    fireEvent.change(within(liste).getByRole('textbox'), { target: { value: 'Kargoya verildi' } });
    await tiklaBekle(within(liste).getByRole('button', { name: 'Notu kaydet' }));
    expect(magazaIstekleri()[1]).toEqual({ adres: '/api/magaza-talepleri/mt-1/durum', yontem: 'POST', basliklar: BASLIK, govde: { onceki: 'sevk', surum: 8, durum: 'sevk', aciklama: 'Kargoya verildi' } });
  });

  it('«Yeniden gönder» → TAM 1 istek: `POST …/bildirim-gonder`, gövde `{}`; 409 `yapilandirilmamis` yanıtındaki ayar ADI ekranda', async () => {
    magazaYaniti(409, { ok: false, kod: 'yapilandirilmamis', kip: 'yerel', eksik: ['APP_URL'] });
    const liste = await magazaSekmesi({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { bildirim: { durum: 'yapilandirilmamis', zaman: ILK } }) });
    await tiklaBekle(within(liste).getByRole('button', { name: 'Yeniden gönder' }));
    expect(magazaIstekleri()).toEqual([{ adres: '/api/magaza-talepleri/mt-1/bildirim-gonder', yontem: 'POST', basliklar: BASLIK, govde: {} }]);
    expect(within(liste).getByRole('alert').textContent).toBe('Sunucu posta ayarı eksik: APP_URL');
  });

  it('`gitti` bildirimli talepte «Yeniden gönder» sayfada YOK (çift posta çiti)', async () => {
    const liste = await magazaSekmesi({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK) });
    expect(within(liste).queryByRole('button', { name: /yeniden gönder/i })).toBeNull();
  });

  it('arama kutusu ve «Etiket basıldı» satırı sayfada: barkod metni + Enter tek eşleşmenin detayını açar; istek ATILMAZ', async () => {
    const etiketZamani = new Date(2026, 9, 8, 14, 5, 0).toISOString();   // yerel 14:05 (saat dilimine takılmasın)
    const liste = await magazaSekmesi(
      { id: 'mt-1', veri: talepDokumani('T261008-CZZF', ILK, { durum: 'teslim', etiketBasildi: { zaman: etiketZamani, koli: 3, kim: { uid: 'u-9', panel: true } } }) },
      { id: 'mt-2', veri: talepDokumani('T261008-AB12', '2026-10-08T09:30:00.000Z') },
    );
    // Varsayılan süzgeç «açık»: teslim edilmiş talep listede yok.
    expect(within(liste).queryByText('T261008-CZZF')).toBeNull();
    expect(dugme('Mağaza Talepleri 1 yeni talep')).not.toBeNull();
    const kutu = within(liste).getByRole('searchbox', { name: 'Talep ara (no, telefon son 4 hane, müşteri)' });
    fireEvent.change(kutu, { target: { value: 'T261008-CZZF' } });
    fireEvent.keyDown(kutu, { key: 'Enter' });
    expect(within(liste).getByText('T261008-CZZF')).toBeTruthy();
    expect(within(liste).queryByText('T261008-AB12')).toBeNull();
    const detay = within(liste).getByRole('region', { name: 'T261008-CZZF talep detayı' });
    expect(within(detay).getByText('Etiket basıldı 14:05 (3 koli)')).toBeTruthy();
    expect(within(liste).queryByRole('button', { name: /etiket/i })).toBeNull();   // ERP'de etiket basma düğmesi yok
    expect(magazaIstekleri()).toEqual([]);
    // Sekme rozeti aramadan ETKİLENMEZ: sayı bütün taleplerden, süzülmüş listeden değil.
    expect(dugme('Mağaza Talepleri 1 yeni talep')).not.toBeNull();
  });
});

// ── Dilim 2b: «yazıldı ama bağlanmadı» — içerik, silme / geri alma, elle talep ve revize bildirimi GERÇEK sayfadan uca gidiyor ──
describe('OrdersPage — Mağaza Talepleri dilim 2b işlemleri gerçek sayfadan uca bağlı', { timeout: 30_000 }, () => {
  const ILK = '2026-10-08T09:00:00.000Z';
  const BASLIK = { 'Content-Type': 'application/json' };
  const MUSTERI = { ad: 'Şükrü Çağlayan', firma: 'Çağlayan İnşaat', telefon: '0532 111 22 33', eposta: '', il: 'İzmir', adres: '', vergi: '' };
  const silindi = { zaman: '2026-10-08T10:00:00.000Z', kim: { uid: 'uid-7', ad: 'Yönetici' }, kanal: 'erp' };
  async function magazaSekmesi(ek: Partial<Props>, ...d: Array<{ id: string; veri: unknown }>) {
    await sayfaCiz(ek);
    talepGonder(...d);
    tikla(MAGAZA);
    return screen.getByRole('region', { name: 'Mağaza Talepleri' });
  }
  const detayAc = (liste: HTMLElement): void => { fireEvent.click(within(liste).getByRole('button', { expanded: false })); };
  /**
   * Onay penceresi: uygulamada `GlobalConfirm` `lib/confirm`e dinleyici bağlar; bu sayfa testinde o bileşen yoktur. Aynı kapıdan
   * (gerçek `confirmAction`) verilen yanıtla kapanan dinleyici bağlanır — bağlanmazsa `confirmAction` «hayır» döner (fail-closed).
   */
  const onaylar: ConfirmOpts[] = [];
  let dinleyiciyiKaldir: (() => void) | null = null;
  const onayYaniti = (yanit: boolean): void => {
    dinleyiciyiKaldir = _registerConfirmListener(secenek => { if (secenek !== null) { onaylar.push(secenek); _resolveConfirm(yanit); } });
  };
  beforeEach(() => { onaylar.length = 0; });
  afterEach(() => { dinleyiciyiKaldir?.(); dinleyiciyiKaldir = null; });

  it('süzgeç DÖRT düğme (V24): Açık · Kapalı · Silinen / İptal · Hepsi — sayılar canlı / silinmiş ayrımıyla; silinmiş talep yalnız sekmesinde', async () => {
    const liste = await magazaSekmesi({},
      { id: 'mt-1', veri: talepDokumani('T261008-ACIK', ILK) },
      { id: 'mt-2', veri: talepDokumani('T261008-TSLM', ILK, { durum: 'teslim' }) },
      { id: 'mt-3', veri: talepDokumani('T261008-IPTL', ILK, { durum: 'iptal' }) },
      { id: 'mt-4', veri: talepDokumani('T261008-SLNM', ILK, { silindi }) },
    );
    const dugmeler = within(within(liste).getByRole('group', { name: 'Durum süzgeci' })).getAllByRole('button');
    expect(dugmeler.map(b => b.textContent)).toEqual(['Açık 1', 'Kapalı 1', 'Silinen / İptal 2', 'Hepsi 3']);
    expect(within(liste).queryByText('T261008-SLNM')).toBeNull();
    fireEvent.click(dugmeler[3]);
    expect(within(liste).queryByText('T261008-SLNM')).toBeNull();                 // «Hepsi»de silinmiş YOK
    fireEvent.click(dugmeler[2]);
    expect(within(liste).getByText('T261008-SLNM')).toBeTruthy();
    expect(within(liste).getByText('Silindi')).toBeTruthy();
    // Sekme rozetinin «yeni» sayısı silinmişi saymaz (canlı `yeni`: yalnız T261008-ACIK).
    expect(dugme('Mağaza Talepleri 1 yeni talep')).not.toBeNull();
  });

  it('«Düzenle» → form → «İçeriği kaydet» → TAM 1 istek: `POST …/:id/icerik`, gövdede açılıştaki `icerikSurum` + yedi müşteri alanı + not + beyan kopyasından teyit; başarıda «İçerik kaydedildi»', async () => {
    magazaYaniti(200, { ok: true, degisti: true });
    const liste = await magazaSekmesi({ userRole: 'Sales' }, { id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { icerikSurum: 2, not: 'Öğleden sonra' }) });
    detayAc(liste);
    fireEvent.click(within(liste).getByRole('button', { name: 'Düzenle' }));
    const form = within(liste).getByRole('group', { name: 'İçeriği düzenle — T261008-AB12' });
    fireEvent.change(within(form).getByLabelText('Müşteri adı (zorunlu)'), { target: { value: 'Şükrü Çağlayan (yetkili)' } });
    await tiklaBekle(within(form).getByRole('button', { name: 'İçeriği kaydet' }));
    expect(magazaIstekleri()).toEqual([{
      adres: '/api/magaza-talepleri/mt-1/icerik', yontem: 'POST', basliklar: BASLIK,
      // Teyidi olmayan talep beyan kopyasıyla açılır (§ 10.4) ve form TAM gövde gönderir: `teyit` `b:<dizin>` satırıyla.
      govde: {
        icerikSurum: 2, musteri: { ...MUSTERI, ad: 'Şükrü Çağlayan (yetkili)' }, not: 'Öğleden sonra',
        teyit: { kalemler: [{ anahtar: 'b:0', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 204.99, tedarik: false }] },
      },
    }]);
    expect(within(liste).queryByRole('group', { name: /^İçeriği düzenle/ })).toBeNull();
    expect(within(liste).getByRole('status').textContent).toBe('İçerik kaydedildi.');
    // İyimser güncelleme YOK: ad akış yeni belgeyi getirince değişir.
    expect(within(liste).queryByText('Şükrü Çağlayan (yetkili)')).toBeNull();
  });

  it('409 `surum-eski` sayfada: form açık kalır ve «başka biri düzenledi; yeniden açın» der', async () => {
    magazaYaniti(409, { ok: false, kod: 'surum-eski', icerikSurum: 9 });
    const liste = await magazaSekmesi({}, { id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK) });
    detayAc(liste);
    fireEvent.click(within(liste).getByRole('button', { name: 'Düzenle' }));
    const form = within(liste).getByRole('group', { name: /^İçeriği düzenle/ });
    await tiklaBekle(within(form).getByRole('button', { name: 'İçeriği kaydet' }));
    expect(within(form).getByRole('alert').textContent).toBe('Başka biri bu talebin içeriğini düzenledi; kaydedilmedi. Formu kapatıp yeniden açın.');
  });

  it('`urunKdvOrani` sayfanın GERÇEK `inventory` kopyasından: taban stok koduyla (`-Dnnn` soneki) eşleşen kalem ürünün oranıyla, eşleşmeyen %20 + «varsayılan» imiyle açılır', async () => {
    magazaYaniti(200, { ok: true, degisti: true });
    const inventory = [
      { id: 'i1', sku: 'DYO-0001', name: 'İç cephe boyası', stockLevel: 5, lowStockThreshold: 1, prices: {}, costPrice: 0, vatRate: 10 },
      { id: 'i2', sku: 'ESKI-18', name: 'Eski oranlı', stockLevel: 5, lowStockThreshold: 1, prices: {}, costPrice: 0, vatRate: 18 },
    ];
    const kalemler = [
      { id: 'u1', sku: 'DYO-0001-D012', ad: 'Boya (12\'li paket)', marka: 'DYO', adet: 1, talepFiyat: 2400, tedarik: false },
      { id: 'u2', sku: 'ESKI-18', ad: 'Eski oranlı ürün', marka: '', adet: 2, talepFiyat: 50, tedarik: false },
      { id: 'u3', sku: 'YOK-1', ad: 'Kartı olmayan ürün', marka: '', adet: 1, talepFiyat: null, tedarik: true },
    ];
    const liste = await magazaSekmesi({ inventory }, { id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { kalemler }) });
    detayAc(liste);
    fireEvent.click(within(liste).getByRole('button', { name: 'Düzenle' }));
    const form = within(liste).getByRole('group', { name: /^İçeriği düzenle/ });
    // Teyidi olmayan talep müşteri beyanının kopyasıyla açılır (§ 10.4): «kopyala» düğmesine gerek yok.
    expect(within(form).queryByRole('button', { name: 'Müşteri beyanından kopyala' })).toBeNull();
    const secici = (ad: string) => within(form).getByLabelText(`KDV oranı: ${ad}`) as HTMLSelectElement;
    expect([secici('Boya (12\'li paket)').value, secici('Eski oranlı ürün').value, secici('Kartı olmayan ürün').value]).toEqual(['10', '20', '20']);
    // %18 kümede yok ve kartı olmayan ürün: ikisi de %20 + «varsayılan» imi; ürün kaydından okunan %10'da im yok.
    expect(within(form).getAllByText('varsayılan')).toHaveLength(2);
    // Önizleme (fiyatı boş kalem var): üç toplam da «fiyat sorulacak».
    expect(within(form).getByRole('status', { name: 'Genel toplam' }).textContent).toBe('fiyat sorulacak');

    await tiklaBekle(within(form).getByRole('button', { name: 'İçeriği kaydet' }));
    const govde = magazaIstekleri()[0].govde as { teyit: { kalemler: Array<Record<string, unknown>> } };
    // Beyandan kopya `b:<dizin>` anahtarıyla; personel oran seçmedi → gövdede `kdvOrani` YOK (sunucu aynı kuralla çözer).
    expect(govde.teyit.kalemler).toEqual([
      { anahtar: 'b:0', id: 'u1', sku: 'DYO-0001-D012', ad: 'Boya (12\'li paket)', marka: 'DYO', adet: 1, birimFiyat: 2400, tedarik: false },
      { anahtar: 'b:1', id: 'u2', sku: 'ESKI-18', ad: 'Eski oranlı ürün', marka: '', adet: 2, birimFiyat: 50, tedarik: false },
      { anahtar: 'b:2', id: 'u3', sku: 'YOK-1', ad: 'Kartı olmayan ürün', marka: '', adet: 1, birimFiyat: null, tedarik: true },
    ]);
  });

  it('«Sil» yalnız Yönetici\'de çizilir (Müdür ve Satış\'ta YOK); onayda «hayır» → istek yok', async () => {
    onayYaniti(false);
    const { rerender } = await sayfaCiz({ userRole: 'Sales' });
    talepGonder({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { durumSurum: 4 }) });
    tikla(MAGAZA);
    const liste = screen.getByRole('region', { name: 'Mağaza Talepleri' });
    detayAc(liste);
    expect(within(liste).getByRole('button', { name: 'Düzenle' })).toBeTruthy();
    expect(within(liste).queryByRole('button', { name: 'Sil' })).toBeNull();
    rerender(<OrdersPage {...ozellikler({ userRole: 'Manager' })} />);
    expect(within(liste).queryByRole('button', { name: 'Sil' })).toBeNull();
    rerender(<OrdersPage {...ozellikler({ userRole: 'Admin' })} />);
    await tiklaBekle(within(liste).getByRole('button', { name: 'Sil' }));
    expect(onaylar).toHaveLength(1);
    expect(onaylar[0].message).toContain('«T261008-AB12» silinecek. Kayıt durur');
    expect(magazaIstekleri()).toEqual([]);
  });

  it('Yönetici «Sil» + onay → TAM 1 istek: `POST …/:id/sil`, gövde `{ surum }`; akış silinmiş belgeyi getirince «Silinen / İptal»de «Geri al» → `{ surum, geriAl: true }`', async () => {
    onayYaniti(true);
    magazaYaniti(200, { ok: true });
    const liste = await magazaSekmesi({ userRole: 'Admin' }, { id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { durumSurum: 4 }) });
    detayAc(liste);
    await tiklaBekle(within(liste).getByRole('button', { name: 'Sil' }));
    await act(async () => {});
    expect(magazaIstekleri()).toEqual([{ adres: '/api/magaza-talepleri/mt-1/sil', yontem: 'POST', basliklar: BASLIK, govde: { surum: 4 } }]);
    expect(within(liste).getByRole('status').textContent).toMatch(/^Talep T261008-AB12 silindi\. Kayıt durur/);

    talepGonder({ id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { durumSurum: 5, silindi }) });
    expect(within(liste).queryByText('T261008-AB12')).toBeNull();                  // «Açık»tan düştü
    fireEvent.click(within(liste).getByRole('button', { name: /^Silinen \/ İptal/ }));
    await tiklaBekle(within(liste).getByRole('button', { name: 'Geri al' }));
    expect(onaylar).toHaveLength(1);                                               // geri alma onay sormaz
    expect(magazaIstekleri()[1]).toEqual({ adres: '/api/magaza-talepleri/mt-1/sil', yontem: 'POST', basliklar: BASLIK, govde: { surum: 5, geriAl: true } });
  });

  it('«Yeni talep (elle)» → form → «Talebi aç» → TAM 1 istek: `POST /api/magaza-talepleri` (kök); 201 yanıtındaki numara liste başında', async () => {
    magazaYaniti(201, { ok: true, id: 'mt-0123456789abcdef0123456789abcdef', talepNo: 'T261011-ELLE' });
    const liste = await magazaSekmesi({ userRole: 'Manager' });
    fireEvent.click(within(liste).getByRole('button', { name: 'Yeni talep (elle)' }));
    const form = within(liste).getByRole('group', { name: 'Yeni talep (elle)' });
    fireEvent.change(within(form).getByLabelText('Müşteri adı (zorunlu)'), { target: { value: 'Hüseyin Ağaoğlu' } });
    fireEvent.change(within(form).getByLabelText('Telefon (zorunlu, en az 10 rakam)'), { target: { value: '0532 111 22 33' } });
    fireEvent.change(within(form).getByLabelText('Ürün adı: 1. kalem'), { target: { value: 'Dış cephe boyası' } });
    fireEvent.change(within(form).getByLabelText('Adet: Dış cephe boyası'), { target: { value: '3' } });
    await tiklaBekle(within(form).getByRole('button', { name: 'Talebi aç' }));
    expect(magazaIstekleri()).toEqual([{
      adres: '/api/magaza-talepleri', yontem: 'POST', basliklar: BASLIK,
      govde: {
        musteri: { ad: 'Hüseyin Ağaoğlu', firma: '', telefon: '0532 111 22 33', eposta: '', il: '', adres: '', vergi: '' },
        not: '',
        kalemler: [{ ad: 'Dış cephe boyası', adet: 3, sku: '', marka: '', birimFiyat: null, tedarik: false }],
      },
    }]);
    expect(within(liste).queryByRole('group', { name: 'Yeni talep (elle)' })).toBeNull();
    expect(within(liste).getByRole('status').textContent).toBe('Talep açıldı: T261011-ELLE. «Yeni» aşamasında; bildirim e-postası kuyruğa alındı.');
  });

  it('revize bildirimi rozeti + «Revizeyi yeniden gönder» → TAM 1 istek: `POST …/bildirim-gonder?tur=revize`, gövde `{}`', async () => {
    magazaYaniti(200, { ok: true });
    const liste = await magazaSekmesi({ userRole: 'Sales' }, { id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, {
      icerikSurum: 1, icerikZamani: ILK,
      bildirimRevize: { durum: 'gonderilemedi', zaman: ILK, alanlar: ['not', 'not', 'teyit'], kim: { uid: 'uid-7', ad: 'Satış Personeli' }, icerikSurum: 1 },
    }) });
    const rozet = within(liste).getByText('Revize bildirimi: gönderilmedi');
    expect(rozet.getAttribute('title')).toBe('Değişen alanlar: müşteri notu, teyit edilen kalemler');   // yinelenen ad tekilleşti
    // İlk bildirim `gitti`: yalnız revize düğmesi var.
    expect(within(liste).queryByRole('button', { name: 'Yeniden gönder' })).toBeNull();
    await tiklaBekle(within(liste).getByRole('button', { name: 'Revizeyi yeniden gönder' }));
    expect(magazaIstekleri()).toEqual([{ adres: '/api/magaza-talepleri/mt-1/bildirim-gonder?tur=revize', yontem: 'POST', basliklar: BASLIK, govde: {} }]);
    expect(within(liste).getByRole('status').textContent).toBe('Bildirim kuyruğa alındı.');
  });

  it('teyit yazılmış talep sayfada: iki tablo yan yana ve teslim kutusu `t:` anahtarıyla istek atar', async () => {
    magazaYaniti(200, { ok: true });
    const teyit = {
      kalemler: [{ anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 20, kdvKaynagi: 'urun', tedarik: false },
        { anahtar: 't:bbbbbbbbbbbb', id: '', sku: 'FRC-12', ad: 'Fırça', marka: '', adet: 1, birimFiyat: 40, kdvOrani: 20, kdvKaynagi: 'personel', tedarik: false }],
      araToplam: 230, kdv: 46, toplam: 276, zaman: ILK, kim: { uid: 'uid-7', ad: 'Satış Personeli' },
    };
    const liste = await magazaSekmesi({ userRole: 'Sales' }, { id: 'mt-1', veri: talepDokumani('T261008-AB12', ILK, { durum: 'sevk', durumSurum: 3, icerikSurum: 1, teyit }) });
    detayAc(liste);
    const teyitGrubu = within(liste).getByRole('group', { name: 'Teyit edilen' });
    expect(within(liste).getAllByRole('table')).toHaveLength(2);
    expect(within(teyitGrubu).getByText('Genel toplam').nextElementSibling?.textContent).toBe('₺276,00');
    expect(within(within(liste).getByRole('group', { name: 'Talep edilen (sitede görülen)' })).queryByRole('checkbox')).toBeNull();
    await tiklaBekle(within(teyitGrubu).getByRole('checkbox', { name: 'Teslim edildi: Fırça' }));
    expect(magazaIstekleri()).toEqual([{ adres: '/api/magaza-talepleri/mt-1/kalem-teslim', yontem: 'POST', basliklar: BASLIK, govde: { surum: 3, teslim: true, kalemler: ['t:bbbbbbbbbbbb'] } }]);
  });
});
