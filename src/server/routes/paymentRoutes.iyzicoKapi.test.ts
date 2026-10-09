/**
 * paymentRoutes.iyzicoKapi.test.ts — POST /api/iyzico/payment-link KİRACI KAPISININ davranışı (2026-10-02 incelemesi).
 *
 * Kapı uçta elle yazılı (sipariş VAR ve çağıranın kiracısının olmalı — dış sisteme gitmeden ÖNCE). Değişmez testi yalnız
 * koşul satırının metnini ve `fetch`'ten önce geldiğini sabitliyordu: `dc`'nin NEREDEN okunduğu bozulursa (yanlış alan, her
 * sipariş "etiketsiz" sayılır) başka kiracının personeli o kiracının sipariş kimliğiyle bağlantı üretip siparişe KENDİ
 * `companyId`'sini yazabilir (sipariş sahibinden kaybolur) ve test yeşil kalırdı. Burada uç GERÇEKTEN koşar.
 * Kalıp: reportsRoutes.stokFiyat.test.ts (sahte Express, işleyici yakalama). Ağ / DB YOK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { paymentRoutes, type PaymentRouteCtx } from './paymentRoutes';

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet, use: () => undefined };
}
const gecir = (_r: unknown, _s: unknown, next: () => void) => next();

function kur(siparisler: Record<string, Record<string, unknown>>, cagiranKiraci: string) {
  const set = vi.fn<(veri: Record<string, unknown>, secenek?: { merge?: boolean }) => Promise<void>>(async () => undefined);
  const adminDb = {
    collection: (ad: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: ad === 'orders' && id in siparisler, data: () => (ad === 'orders' ? siparisler[id] : undefined) }),
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
  return { isleyici, set };
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
