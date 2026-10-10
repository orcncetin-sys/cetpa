/**
 * paymentRoutes.iyzicoKapi.test.ts — POST /api/iyzico/payment-link KİRACI KAPISININ davranışı (2026-10-02 incelemesi).
 *
 * Kapı uçta elle yazılı (sipariş VAR ve çağıranın kiracısının olmalı — dış sisteme gitmeden ÖNCE). Değişmez testi yalnız
 * koşul satırının metnini ve `fetch`'ten önce geldiğini sabitliyordu: `dc`'nin NEREDEN okunduğu bozulursa (yanlış alan, her
 * sipariş "etiketsiz" sayılır) başka kiracının personeli o kiracının sipariş kimliğiyle bağlantı üretip siparişe KENDİ
 * `companyId`'sini yazabilir (sipariş sahibinden kaybolur) ve test yeşil kalırdı. Burada uç GERÇEKTEN koşar.
 * Kalıp: reportsRoutes.stokFiyat.test.ts (sahte Express, işleyici yakalama). Ağ / DB YOK.
 *
 * 2026-10-10 — TESLİMAT BLOĞU (sipariş penceresinde ülke / il seçimi): iyzico gövdesinin `shippingAddress.city` /
 * `.country` değerleri sipariş KAYDINDAN gelir (kapıda zaten okunan kayıt; ikinci okuma yok, istek gövdesinden alınmaz).
 * `buyer` ve `billingAddress` blokları her durumda bugünkü sabitlerle kalır. Aynı düzenekle, ikinci `describe`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { paymentRoutes, type PaymentRouteCtx } from './paymentRoutes';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet, use: () => undefined };
}
const gecir = (_r: unknown, _s: unknown, next: () => void) => next();

function kur(siparisler: Record<string, Record<string, unknown>>, cagiranKiraci: string) {
  const set = vi.fn<(veri: Record<string, unknown>, secenek?: { merge?: boolean }) => Promise<void>>(async () => undefined);
  const okuma = vi.fn<(ad: string, id: string) => void>();
  const adminDb = {
    collection: (ad: string) => ({
      doc: (id: string) => ({
        get: async () => { okuma(ad, id); return { exists: ad === 'orders' && id in siparisler, data: () => (ad === 'orders' ? siparisler[id] : undefined) }; },
        set,
      }),
    }),
  };
  const C = {
    getAdminDb: () => adminDb, getBoss: () => null, getStripeClient: () => null,
    requireAuth: gecir, requireStaff: gecir, requireMfaVerified: gecir, paymentLimiter: gecir,
    reqActor: () => ({ uid: 'u1', email: 'personel@ornek.test' }),
    reqCompanyId: async () => cagiranKiraci,
    writeAuditLog: vi.fn(async () => undefined), pgServerTimestamp: () => 'ZAMAN',
    processStripeWebhook: async () => undefined,
    getIyzicoCreds: async () => ({ apiKey: 'test', secretKey: 'test', baseUrl: 'https://sandbox-api.iyzipay.com' }),
    iyzicoAuth: () => 'IMZA', toPkiString: () => 'PKI', randStr: () => 'RND',
  } as unknown as PaymentRouteCtx;
  const app = sahteApp();
  paymentRoutes(app as never, C);
  const isleyici = app.handlers['/api/iyzico/payment-link'];
  expect(isleyici, 'rota kayıtlı değil').toBeTypeOf('function');
  return { isleyici, set, okuma };
}
function istek(orderId: string) {
  return { body: { orderId, amount: 120, customerName: 'Şirin Yapı', customerEmail: 'musteri@ornek.test' }, protocol: 'https', get: () => 'app.ornek.test', ip: '127.0.0.1' };
}
function yanit() {
  const r = { kod: 200, govde: undefined as unknown, status(k: number) { r.kod = k; return r; }, json(g: unknown) { r.govde = g; return r; } };
  return r;
}

describe('POST /api/iyzico/payment-link — kiracı kapısı', () => {
  let fetchCasus: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchCasus = vi.fn(async () => ({ json: async () => ({ status: 'success', paymentPageUrl: 'https://odeme.ornek.test/x', token: 'T' }) }));
    vi.stubGlobal('fetch', fetchCasus);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('YABANCI kiracının siparişi → 404; iyzico\'ya gidilmez, siparişe yazılmaz', async () => {
    const { isleyici, set } = kur({ s1: { companyId: 'A', customerName: 'Gizli' } }, 'B');
    const res = yanit();
    await isleyici(istek('s1'), res);
    expect(res.kod).toBe(404);
    expect(fetchCasus).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
  it('olmayan sipariş kimliği → 404; iyzico\'ya gidilmez, sipariş AÇILMAZ', async () => {
    const { isleyici, set } = kur({}, 'B');
    const res = yanit();
    await isleyici(istek('yok'), res);
    expect(res.kod).toBe(404);
    expect(fetchCasus).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
  it('yabancı kiracı ile olmayan sipariş AYNI yanıtı alır (varlık sızmaz)', async () => {
    const a = kur({ s1: { companyId: 'A' } }, 'B'); const ra = yanit(); await a.isleyici(istek('s1'), ra);
    const b = kur({}, 'B'); const rb = yanit(); await b.isleyici(istek('s1'), rb);
    expect([ra.kod, ra.govde]).toEqual([rb.kod, rb.govde]);
  });
  it('KENDİ siparişi → iyzico çağrılır; siparişe çağıranın kiracısı damgalanır', async () => {
    const { isleyici, set } = kur({ s1: { companyId: 'B' } }, 'B');
    const res = yanit();
    await isleyici(istek('s1'), res);
    expect(fetchCasus).toHaveBeenCalledTimes(1);
    expect(String(fetchCasus.mock.calls[0][0])).toBe('https://sandbox-api.iyzipay.com/payment/initialize/checkout');
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0]).toMatchObject({ companyId: 'B', iyzicoPaymentUrl: 'https://odeme.ornek.test/x' });
    expect(set.mock.calls[0][1]).toEqual({ merge: true });
  });
  it('etiketsiz ESKİ sipariş (companyId yok / boş) kendi sayılır', async () => {
    for (const eski of [{}, { companyId: '' }, { companyId: null }]) {
      fetchCasus.mockClear();
      const { isleyici } = kur({ s1: eski }, 'B');
      await isleyici(istek('s1'), yanit());
      expect(fetchCasus, JSON.stringify(eski)).toHaveBeenCalledTimes(1);
    }
  });
});

describe('POST /api/iyzico/payment-link — teslimat bloğu sipariş KAYDINDAN (şehir / ülke)', () => {
  let fetchCasus: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchCasus = vi.fn(async () => ({ json: async () => ({ status: 'success', paymentPageUrl: 'https://odeme.ornek.test/x', token: 'T' }) }));
    vi.stubGlobal('fetch', fetchCasus);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  type Blok = Record<string, unknown>;
  type Govde = { buyer: Blok; shippingAddress: Blok; billingAddress: Blok } & Blok;
  /** Uç gerçekten koşar; iyzico'ya giden gövde (fetch'in `body`si) döner. `ek`: İSTEK gövdesine eklenen alanlar. */
  async function govde(kayit: Record<string, unknown>, ek: Record<string, unknown> = {}): Promise<{ g: Govde; okuma: ReturnType<typeof kur>['okuma'] }> {
    fetchCasus.mockClear();
    const { isleyici, okuma } = kur({ s1: { companyId: 'B', ...kayit } }, 'B');
    const ist = istek('s1');
    await isleyici({ ...ist, body: { ...ist.body, ...ek } }, yanit());
    expect(fetchCasus, 'iyzico çağrılmadı').toHaveBeenCalledTimes(1);
    return { g: JSON.parse(String((fetchCasus.mock.calls[0][1] as { body: string }).body)) as Govde, okuma };
  }
  // Bugünkü (2026-10-10 öncesi) bloklar — birebir. İstek adres yollamadığı için `address` uç varsayılanı 'Türkiye'.
  const ALICI = {
    id: 's1', name: 'Şirin', surname: 'Yapı', email: 'musteri@ornek.test', identityNumber: '11111111111',
    registrationAddress: 'Türkiye', city: 'İstanbul', country: 'Turkey', ip: '127.0.0.1', gsmNumber: '+905000000000',
  };
  const ADRES = { contactName: 'Şirin Yapı', city: 'İstanbul', country: 'Turkey', address: 'Türkiye', zipCode: '34000' };

  it('ESKİ kayıt (il / ülke alanı yok) → gövde birebir: üç blok da bugünkü sabitlerle', async () => {
    for (const eski of [{}, { shippingAddress: 'Muratpaşa, Antalya' }, { teslimatSehri: null, teslimatUlke: null }, { teslimatSehri: '  ', teslimatUlke: '' }]) {
      const { g } = await govde(eski);
      expect(g.buyer, JSON.stringify(eski)).toEqual(ALICI);
      expect(g.shippingAddress, JSON.stringify(eski)).toEqual(ADRES);
      expect(g.billingAddress, JSON.stringify(eski)).toEqual(ADRES);
    }
  });
  it('il seçili sipariş → shippingAddress.city il adı; ülke TR (yazılı ya da yok) → country sabit \'Turkey\'', async () => {
    for (const kayit of [{ teslimatSehri: 'Antalya', teslimatUlke: 'TR' }, { teslimatSehri: ' Antalya ' }]) {
      const { g } = await govde(kayit);
      expect(g.shippingAddress, JSON.stringify(kayit)).toEqual({ ...ADRES, city: 'Antalya' });
    }
    // Yalnız ülkesi yazılı yurt içi sipariş (il seçilmedi): blok bugünkü hâlinde.
    expect((await govde({ teslimatUlke: 'TR' })).g.shippingAddress).toEqual(ADRES);
  });
  it('yabancı ülke → country İngilizce ad (\'DE\' → \'Germany\'); şehir yazıldıysa o, yazılmadıysa sabit', async () => {
    expect((await govde({ teslimatSehri: 'Berlin', teslimatUlke: 'DE' })).g.shippingAddress).toEqual({ ...ADRES, city: 'Berlin', country: 'Germany' });
    expect((await govde({ teslimatUlke: 'DE' })).g.shippingAddress).toEqual({ ...ADRES, country: 'Germany' });
  });
  it('ülke adı çözülemezse (biçimce kod ama adı yok / biçimsiz değer) country sabit kalır — ham kod gövdeye BASILMAZ', async () => {
    for (const kod of ['AA', 'ZZ', 'de', 'DEU', 'Almanya', 49]) {
      const { g } = await govde({ teslimatSehri: 'Antalya', teslimatUlke: kod });
      expect(g.shippingAddress, String(kod)).toEqual({ ...ADRES, city: 'Antalya' });
    }
  });
  it('buyer ve billingAddress HER durumda birebir (il / ülke yalnız teslimat bloğuna girer)', async () => {
    for (const kayit of [{ teslimatSehri: 'Antalya', teslimatUlke: 'TR' }, { teslimatSehri: 'Berlin', teslimatUlke: 'DE' }, { teslimatUlke: 'AA' }]) {
      const { g } = await govde(kayit);
      expect(g.buyer, JSON.stringify(kayit)).toEqual(ALICI);
      expect(g.billingAddress, JSON.stringify(kayit)).toEqual(ADRES);
    }
  });
  it('MAĞAZA siparişinde blok TÜMÜYLE bugünkü hâlinde: «ilçe / il» şehre, ülke kodu country\'ye girmez', async () => {
    const { g } = await govde({ source: MAGAZA_KAYNAGI, teslimatSehri: 'Mitte / Berlin', teslimatUlke: 'DE' });
    expect(g.shippingAddress).toEqual(ADRES);
    expect(g.buyer).toEqual(ALICI);
    expect(g.billingAddress).toEqual(ADRES);
  });
  it('il / ülke İSTEK gövdesinden okunmaz (sözleşmeye alan eklenmedi): kayıt boşken istekteki değer bloğa girmez; kayıt doluyken ezmez', async () => {
    const istekte = { teslimatSehri: 'Ankara', teslimatUlke: 'DE', city: 'Ankara', country: 'Germany' };
    expect((await govde({}, istekte)).g.shippingAddress).toEqual(ADRES);
    expect((await govde({ teslimatSehri: 'Antalya', teslimatUlke: 'TR' }, istekte)).g.shippingAddress).toEqual({ ...ADRES, city: 'Antalya' });
  });
  it('teslimat bloğunun anahtar SIRASI aynı (imza metni sırayla kurulur) ve adres metni istekten gelmeye devam eder', async () => {
    const { g } = await govde({ teslimatSehri: 'Berlin', teslimatUlke: 'DE' }, { shippingAddress: 'Hauptstr. 5, Berlin, Almanya' });
    expect(Object.keys(g.shippingAddress)).toEqual(['contactName', 'city', 'country', 'address', 'zipCode']);
    expect(g.shippingAddress).toEqual({ contactName: 'Şirin Yapı', city: 'Berlin', country: 'Germany', address: 'Hauptstr. 5, Berlin, Almanya', zipCode: '34000' });
  });
  it('sipariş kaydı TEK kez okunur (kiracı kapısındaki okuma; il / ülke için ikinci okuma yok)', async () => {
    const { okuma } = await govde({ teslimatSehri: 'Antalya', teslimatUlke: 'TR' });
    expect(okuma.mock.calls).toEqual([['orders', 's1']]);
  });
});
