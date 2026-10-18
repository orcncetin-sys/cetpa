// @vitest-environment jsdom
/**
 * MikroFatura.uygulama.test.tsx — e-Fatura gönderimi, UYGULAMA düzeyinde: GERÇEK `App.tsx` + GERÇEK `OrdersPage` (2026-10-17,
 * şartname «e-Fatura çift kesim» § 7.4 B2, B7, B9; D6, D8, D11).
 *
 * NEDEN GERÇEK APP: kilit App'te kurulur, düğmeler OrdersPage'de çizilir; aradaki bağ (prop, işleyici, işlevsel yama) birim
 * testinde elle verilirse «kilit sürerken düğme pasif» iddiası kendi kendini doğrular (şartname B6: «prop'u elle verip düğmenin
 * pasifliğine bakmak bu maddeyi KARŞILAMAZ»). Burada kullanıcı düğmeye basar; istek, onay ve yanıt App'in kendi yolundan geçer.
 *
 * Sahte olanlar YALNIZ dış dünya (DisRolEkrani.uygulama.test.tsx kalıbı): Firebase kimliği, `fetch` (sunucu yanıtları elle;
 * fatura isteği istenirse ASKIDA bekletilir), `EventSource` (canlı yayın HİÇ gelmez — B2 «yayın gelmeden» koşulu) ve onay
 * penceresinin kararı (`confirmAction` kaydedilir; «Faturayı kes» / «Vazgeç» sınama verir). Sipariş listesi veri deposuna
 * doğrudan konur (akış başlatılmaz). Tembel sayfalar GERÇEK yüklenir.
 *
 * ETTN (şartname «fatura gövde + gece MF» § 9.B B5 / B6, 2026-10-19): «ETTN ekle» (sıfır GUID'li `gonderildi` siparişte görünür)
 * ve «Mikro'da var» + ETTN uygulama yolundan: onay metni, istek gövdesinde ANAHTAR, yerel yama YANITTAKİ `ettn` ile — yayın
 * gelmeden düğme kaybolur, rozet çizilir.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type React from 'react';
import type { ConfirmOpts } from '../lib/confirm';
import type { Lead, Order } from '../types';

vi.setConfig({ testTimeout: 90_000 });

type SahteYanit = [number, unknown];
const durum = vi.hoisted(() => ({
  kullanici: {
    uid: 'uid-fatura-1', email: 'yonetici@ornek.test', displayName: 'Yönetici', photoURL: '', isAnonymous: false,
    emailVerified: true, tenantId: null, providerData: [], getIdToken: async () => 'belirtec-deneme',
  },
  /** Onay penceresine verilen seçenekler (sırayla) ve sınamanın kararı. */
  onaylar: [] as Array<{ title: string; message: string; variant?: string; confirmLabel?: string }>,
  onayKarari: true,
  /** Onay penceresi AÇIKKEN (karar dönmeden) bir kez koşar — «pencere açıkken yayın geldi» (İ1-6). */
  onayKancasi: undefined as undefined | (() => void | Promise<void>),
  /** Askıya alınan yollar ve bekleyen çözücüler. */
  askiyaAl: new Set<string>(),
  askida: {} as Record<string, Array<{ coz: (r: Response) => void; reddet: (e: unknown) => void }>>,
  /** Yol başına sıradaki yanıtlar. */
  yanitlar: {} as Record<string, SahteYanit[]>,
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ get currentUser() { return durum.kullanici; } }),
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void | Promise<void>) => { queueMicrotask(() => { void cb(durum.kullanici); }); return () => {}; },
  signOut: async () => {}, deleteUser: async () => {}, getRedirectResult: async () => null,
  GoogleAuthProvider: class {},
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(), sendPasswordResetEmail: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: {
    get currentUser() { return durum.kullanici; },
    onAuthStateChanged: (cb: (u: unknown) => void) => { queueMicrotask(() => cb(durum.kullanici)); return () => {}; },
  },
}));
vi.mock('../lib/confirm', async (asilAl) => {
  const asil = await asilAl<typeof import('../lib/confirm')>();
  return {
    ...asil,
    confirmAction: vi.fn(async (o: ConfirmOpts) => {
      durum.onaylar.push({ title: o.title, message: o.message, variant: o.variant, confirmLabel: o.confirmLabel });
      const kanca = durum.onayKancasi;
      if (kanca) { durum.onayKancasi = undefined; await kanca(); }
      return durum.onayKarari;
    }),
  };
});

interface Istek { yontem: string; yol: string; govde: string }
let istekler: Istek[] = [];
const yanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });
const KENDI = `/api/db/users/${'uid-fatura-1'}`;

function sahteFetch(girdi: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ham = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
  const basliklar = (init?.headers ?? {}) as Record<string, string>;
  const yontem = (basliklar['X-Cetpa-Method'] ?? init?.method ?? 'GET').toUpperCase();
  const yol = ham.split('?')[0];
  istekler.push({ yontem, yol, govde: typeof init?.body === 'string' ? init.body : '' });
  const anahtar = `${yontem} ${yol}`;
  if (durum.askiyaAl.has(anahtar)) return new Promise<Response>((coz, reddet) => { (durum.askida[anahtar] ??= []).push({ coz, reddet }); });
  const sira = durum.yanitlar[anahtar]?.shift();
  if (sira) return Promise.resolve(yanit(sira[1], sira[0]));
  if (yol === '/api/mfa/status') return Promise.resolve(yanit({ enabled: false, verified: false }));
  if (yol === KENDI && yontem === 'GET') return Promise.resolve(yanit({ data: { role: 'Admin', companyId: 'sirket-1', name: 'Yönetici' } }));
  if (yol === '/api/superadmin/me') return Promise.resolve(yanit({ isSuperAdmin: false }));
  if (yol === '/api/settings/exchange-rates') return Promise.resolve(yanit({ rates: { USD: 40, EUR: 45 } }));
  if (yol.startsWith('/api/db/') && yontem === 'GET' && yol.split('/').length === 4) return Promise.resolve(yanit({ docs: [] }));
  return Promise.resolve(yanit({}));
}
class SahteAkis { static CLOSED = 2; readyState = 0; onerror: (() => void) | null = null; addEventListener(): void {} close(): void { this.readyState = 2; } }

const KAYDET = 'POST /api/mikro/fatura/kaydet';
const SONUC = 'POST /api/mikro/fatura/sonuc';
const siparis = (ek: Partial<Order> = {}): Order => ({
  id: 'sip-fatura-1', customerName: 'Şirin Yapı Malzemeleri', totalPrice: 15000, status: 'Processing', customerType: 'B2B',
  orderNumber: 'S-77', lineItems: [], faturali: true, faturaTipi: 'e-arsiv', kdvOran: 20, companyId: 'sirket-1', ...ek,
} as Order);

let App: React.ComponentType;
let veriDeposu: typeof import('../store/dataStore').useDataStore;
let tazele: () => void;
beforeAll(async () => {
  App = (await import('../App')).default;
  veriDeposu = (await import('../store/dataStore')).useDataStore;
  const { resetStream } = await import('../lib/dbClient');
  const { resetLazyCollections } = await import('../lib/lazyCollections');
  const { useAppStore } = await import('../store/appStore');
  tazele = () => { resetStream(); resetLazyCollections(); useAppStore.setState(useAppStore.getInitialState()); };
}, 180_000);

beforeEach(() => {
  istekler = [];
  durum.onaylar = []; durum.onayKarari = true; durum.onayKancasi = undefined; durum.askiyaAl = new Set(); durum.askida = {}; durum.yanitlar = {};
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(sahteFetch));
  vi.stubGlobal('EventSource', SahteAkis);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Uygulamayı Siparişler sekmesinde açar ve sipariş satırının Mikro düğmesi çizilene kadar bekler. */
async function ac(o: Order): Promise<HTMLElement> {
  window.history.pushState({}, '', '/orders');
  tazele();
  veriDeposu.setState({ orders: [o] });
  const { container } = render(<BrowserRouter><App /></BrowserRouter>);
  await waitFor(() => expect(container.querySelector(`[data-mikro-fatura-dugmesi="${o.id}"]`)).not.toBeNull(), { timeout: 60_000 });
  return container;
}
const dugme = (c: HTMLElement, id = 'sip-fatura-1'): HTMLButtonElement => {
  const d = c.querySelector<HTMLButtonElement>(`[data-mikro-fatura-dugmesi="${id}"]`);
  if (!d) throw new Error('Mikro düğmesi yok');
  return d;
};
const kaydetSayisi = () => istekler.filter(i => `${i.yontem} ${i.yol}` === KAYDET).length;
const sonucSayisi = () => istekler.filter(i => `${i.yontem} ${i.yol}` === SONUC).length;
/** Askıdaki fatura isteğini yanıtlar (ya da ağ hatasıyla düşürür). */
async function birak(anahtar: string, y: SahteYanit | 'ag-hatasi') {
  durum.askiyaAl.delete(anahtar);
  const bekleyen = durum.askida[anahtar] ?? [];
  durum.askida[anahtar] = [];
  await act(async () => {
    for (const b of bekleyen) { if (y === 'ag-hatasi') b.reddet(new TypeError('Failed to fetch')); else b.coz(yanit(y[1], y[0])); }
    await new Promise(r => setTimeout(r, 0));
  });
}
const isaretGovdesi = (durumAdi: string) => ({ durum: durumAdi, istekNo: 'istek-1', zaman: '2026-10-17T09:00:00.000Z', kim: 'satis@ornek.test' });

describe('B7 (D11) — handleMikroFatura: ortak uçuş kilidi gerçek App\'te', () => {
  it('«Vazgeç» → kilit alınmaz, istek yok; düğme etkin kalır', async () => {
    const c = await ac(siparis());
    durum.onayKarari = false;
    await act(async () => { fireEvent.click(dugme(c)); });
    await waitFor(() => expect(durum.onaylar).toHaveLength(1));
    expect(durum.onaylar[0].title).toBe('e-Arşiv kesilsin mi?');
    expect(kaydetSayisi()).toBe(0);
    expect(dugme(c).disabled).toBe(false);
  });

  it('kilit sürerken: ikinci tıklama onay penceresi AÇMAZ ve istek atmaz; liste VE ayrıntı düğmesi pasif ve «Gönderiliyor…»; yanıt gelince işaret yayın beklemeden çizilir (B2)', async () => {
    const c = await ac(siparis());
    durum.askiyaAl.add(KAYDET);
    await act(async () => { fireEvent.click(dugme(c)); });
    await waitFor(() => expect(kaydetSayisi()).toBe(1));
    expect(durum.onaylar).toHaveLength(1);
    await waitFor(() => expect(dugme(c).disabled).toBe(true));
    expect(dugme(c).textContent).toContain('Gönderiliyor…');
    await act(async () => { fireEvent.click(dugme(c)); });
    expect(durum.onaylar).toHaveLength(1);
    expect(kaydetSayisi()).toBe(1);
    // Ayrıntıya geç: satıra tıkla — ayrıntı düğmesi de pasif ve «Gönderiliyor…».
    const satir = [...c.querySelectorAll('tr')].find(t => t.textContent?.includes('Şirin Yapı Malzemeleri'));
    if (!satir) throw new Error('satır yok');
    await act(async () => { fireEvent.click(satir); });
    await waitFor(() => expect(c.querySelector('[data-fatura-sonucu]') ?? dugme(c)).toBeTruthy());
    expect(dugme(c).disabled).toBe(true);
    expect(dugme(c).textContent).toContain('Gönderiliyor…');
    // Sunucu: sonuç bilinmiyor (502). Yayın HİÇ gelmez — ayrıntı yanıttaki işarete göre çizilir: düğme yok, uyarı + iki seçenek.
    await birak(KAYDET, [502, { success: false, kod: 'FATURA_SONUCU_BILINMIYOR', error: 'HTTP 502', mikroFaturaGonderimi: isaretGovdesi('belirsiz') }]);
    await waitFor(() => expect(c.querySelector('[data-fatura-sonucu="sip-fatura-1"]')).not.toBeNull());
    expect(c.querySelector('[data-mikro-fatura-dugmesi]')).toBeNull();
    expect(veriDeposu.getState().orders[0].mikroFaturaGonderimi).toMatchObject({ durum: 'belirsiz' });
  });

  it('istek fırlatsa da (ağ hatası) `finally` kilidi bırakır: düğme yeniden etkin, ileti «kesilmiş OLABİLİR»', async () => {
    const c = await ac(siparis());
    durum.askiyaAl.add(KAYDET);
    await act(async () => { fireEvent.click(dugme(c)); });
    await waitFor(() => expect(dugme(c).disabled).toBe(true));
    await birak(KAYDET, 'ag-hatasi');
    await waitFor(() => expect(dugme(c).disabled).toBe(false));
    await waitFor(() => expect(document.body.textContent).toContain('Fatura Mikro\'da kesilmiş OLABİLİR. Tekrar göndermeden önce Mikro\'dan kontrol edin.'));
  });

  it('başarıdan sonra (yanıt işaret / numara taşımasa da — eski sunucu, vekil) bu oturumda: onay penceresi AÇILMAZ, istek atılmaz (D11 (a) + `tamamlandi`)', async () => {
    const c = await ac(siparis());
    // Yanıtta işaret alanı YOK: yerel liste yamanmaz, düğme çizili kalır — koruma yalnız oturum içi «tamamlandı» kümesinde.
    durum.yanitlar[KAYDET] = [[200, { success: true }]];
    await act(async () => { fireEvent.click(dugme(c)); });
    await waitFor(() => expect(kaydetSayisi()).toBe(1));
    await waitFor(() => expect(dugme(c).disabled).toBe(false));
    expect(durum.onaylar).toHaveLength(1);
    await act(async () => { fireEvent.click(dugme(c)); });
    await waitFor(() => expect(document.body.textContent).toContain('Bu siparişin faturası kesildi ya da gönderim sonucu bekleniyor'));
    expect(durum.onaylar, 'ikinci tıklamada onay penceresi açılmamalı (salt-okur denetim onaydan ÖNCE)').toHaveLength(1);
    expect(kaydetSayisi()).toBe(1);
  });

  it('B2 — başarı / 409 / ret / gönderilmedi yanıtından hemen sonra (yayın gelmeden) liste yanıttaki işarete göre çizilir', async () => {
    const c = await ac(siparis());
    // Başarı: işaret `gonderildi` + numara → düğme kaybolur, numara rozeti.
    durum.yanitlar[KAYDET] = [[200, { success: true, mikroFaturaNo: 'CTP2026000000123', mikroFaturaGonderimi: { ...isaretGovdesi('gonderildi'), numara: 'CTP2026000000123' } }]];
    await act(async () => { fireEvent.click(dugme(c)); });
    await waitFor(() => expect(c.querySelector('[data-mikro-fatura-dugmesi]')).toBeNull());
    expect(c.textContent).toContain('CTP2026000000123');
    // Başarıdan sonra bu oturumda yeniden gönderim YOK (canlı liste bayatlasa da — `tamamlandi`).
    expect(kaydetSayisi()).toBe(1);
    cleanup();
    // Ret: işaret `reddedildi` → düğme kalır (yeniden gönderilebilir), «Mikro reddetti» rozeti.
    const c2 = await ac(siparis());
    durum.yanitlar[KAYDET] = [[200, { success: false, kod: 'FATURA_REDDEDILDI', error: 'Cari bulunamadı', mikroFaturaGonderimi: isaretGovdesi('reddedildi') }]];
    await act(async () => { fireEvent.click(dugme(c2)); });
    await waitFor(() => expect(c2.querySelector('[data-fatura-durumu="sip-fatura-1"]')?.textContent).toBe('Mikro reddetti'));
    expect(dugme(c2).disabled).toBe(false);
    cleanup();
    // 409 gönderiliyor: işaret taze `gonderiliyor` → düğme kaybolur, «Fatura gönderiliyor».
    const c3 = await ac(siparis());
    durum.yanitlar[KAYDET] = [[409, { success: false, kod: 'FATURA_GONDERILIYOR', mikroFaturaGonderimi: { ...isaretGovdesi('gonderiliyor'), zaman: new Date().toISOString() } }]];
    await act(async () => { fireEvent.click(dugme(c3)); });
    await waitFor(() => expect(c3.querySelector('[data-fatura-durumu="sip-fatura-1"]')?.textContent).toBe('Fatura gönderiliyor'));
    expect(c3.querySelector('[data-mikro-fatura-dugmesi]')).toBeNull();
    cleanup();
    // Gönderilmedi (geri alındı): işaret `null` → düğme etkin kalır, rozet yok.
    const c4 = await ac(siparis());
    durum.yanitlar[KAYDET] = [[502, { success: false, kod: 'FATURA_GONDERILMEDI', error: 'Mikro token alınamadı (500)', mikroFaturaGonderimi: null }]];
    await act(async () => { fireEvent.click(dugme(c4)); });
    await waitFor(() => expect(document.body.textContent).toContain('Fatura gönderilmedi: Mikro token alınamadı (500)'));
    expect(dugme(c4).disabled).toBe(false);
    expect(c4.querySelector('[data-fatura-durumu]')).toBeNull();
  });
});

describe('B9 (D6) — belirsiz siparişte iki seçenek; «Mikro\'da yok» onayı `danger`, metinde cari / tutar / zaman / kim; onaysız çağrı yok', () => {
  it('Vazgeç → istek yok; onay → `fatura/sonuc`; yanıt işareti silince kesim düğmesi geri gelir', async () => {
    const o = siparis({ mikroFaturaGonderimi: { durum: 'belirsiz', istekNo: 'istek-1', zaman: '2026-10-17T09:00:00.000Z', kim: 'satis@ornek.test' } });
    window.history.pushState({}, '', '/orders');
    tazele();
    veriDeposu.setState({ orders: [o] });
    const { container: c } = render(<BrowserRouter><App /></BrowserRouter>);
    const satir = await waitFor(() => {
      const s = [...c.querySelectorAll('tr')].find(t => t.textContent?.includes('Şirin Yapı Malzemeleri'));
      if (!s) throw new Error('satır yok');
      return s;
    }, { timeout: 60_000 });
    expect(c.querySelector('[data-mikro-fatura-dugmesi]')).toBeNull();
    await act(async () => { fireEvent.click(satir); });
    const uyari = await waitFor(() => {
      const u = c.querySelector<HTMLElement>('[data-fatura-sonucu="sip-fatura-1"]');
      if (!u) throw new Error('uyarı yok');
      return u;
    });
    const yokDugmesi = [...uyari.querySelectorAll('button')].find(b => b.textContent === 'Mikro\'da yok, yeniden gönderilebilir');
    if (!yokDugmesi) throw new Error('seçenek yok');
    durum.onayKarari = false;
    await act(async () => { fireEvent.click(yokDugmesi); });
    await waitFor(() => expect(durum.onaylar).toHaveLength(1));
    expect(sonucSayisi()).toBe(0);
    const onay = durum.onaylar[0];
    expect(onay.variant).toBe('danger');
    expect(onay.confirmLabel).toBe('Mikro\'da yok, yeniden gönderilebilir');
    expect(onay.message).toContain('Şirin Yapı Malzemeleri');
    expect(onay.message).toContain('15.000');
    expect(onay.message).toContain('satis@ornek.test');
    expect(onay.message).toMatch(/17\.10\.2026/);
    durum.onayKarari = true;
    durum.yanitlar[SONUC] = [[200, { success: true, karar: 'mikrodaYok', mikroFaturaGonderimi: null }]];
    await act(async () => { fireEvent.click(yokDugmesi); });
    await waitFor(() => expect(sonucSayisi()).toBe(1));
    expect(JSON.parse(istekler.filter(i => `${i.yontem} ${i.yol}` === SONUC)[0].govde)).toEqual({ firebaseId: 'sip-fatura-1', karar: 'mikrodaYok' });
    await waitFor(() => expect(c.querySelector('[data-mikro-fatura-dugmesi="sip-fatura-1"]')).not.toBeNull());
    expect(c.querySelector('[data-fatura-sonucu]')).toBeNull();
    expect(veriDeposu.getState().orders[0]).not.toHaveProperty('mikroFaturaGonderimi');
  });
});

describe('İnceleme 1 — onaydan sonraki yeniden denetim GÜNCEL depodan (İ1-6), «işaretlenemedi» iletisi (İA-2), «Mikro\'da var» yaması (İ1-4)', () => {
  const yayinGeldi = (ek: Partial<Order>) => {
    // Canlı yayının yaptığının aynısı: veri deposundaki sipariş satırı değişir (akış dinleyicisi `orders`ı tazeler).
    veriDeposu.setState(s => ({ orders: s.orders.map(o => (o.id === 'sip-fatura-1' ? { ...o, ...ek } : o)) }));
  };

  it('İ1-6 — e-Fatura: onay penceresi açıkken yayın gelir (başka sekme gönderiyor) → «Faturayı kes» onayından sonra kaydet isteği 0', async () => {
    const c = await ac(siparis());
    durum.onayKancasi = () => yayinGeldi({ mikroFaturaGonderimi: { durum: 'gonderiliyor', istekNo: 'baska-sekme', zaman: new Date().toISOString(), kim: 'baska@ornek.test' } });
    await act(async () => { fireEvent.click(dugme(c)); });
    await waitFor(() => expect(durum.onaylar).toHaveLength(1));
    await waitFor(() => expect(document.body.textContent).toContain('Bu siparişin faturası kesildi ya da gönderim sonucu bekleniyor'));
    expect(kaydetSayisi(), 'pencereyi açan çizimin `orders`ı bayat — yeniden denetim depodan okumalı').toBe(0);
  });

  it('İ1-6 — e-İrsaliye: onay penceresi açıkken yayın gelir (başka sekme irsaliyeyi kesti) → onaydan sonra irsaliye isteği 0', async () => {
    const IRSALIYE = 'POST /api/mikro/irsaliye/kaydet';
    const cari = { id: 'cari-1', name: 'Şirin Yapı Malzemeleri', company: 'Şirin Yapı Malzemeleri', mikroCariKod: '120.01.0042', companyId: 'sirket-1' } as unknown as Lead;
    const o = siparis({
      status: 'Shipped', leadId: 'cari-1', depoNo: 2,
      lineItems: [{ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 312.5 }],
    } as Partial<Order>);
    const c = await ac(o);
    await act(async () => { veriDeposu.setState({ leads: [cari] }); });
    const satir = [...c.querySelectorAll('tr')].find(t => t.textContent?.includes('Şirin Yapı Malzemeleri'));
    if (!satir) throw new Error('satır yok');
    await act(async () => { fireEvent.click(satir); });
    const irsaliyeDugmesi = await waitFor(() => {
      const d = [...c.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'e-İrsaliye gönder');
      if (!d) throw new Error('e-İrsaliye düğmesi yok');
      expect(d.disabled, 'düğme etkin (istek kurulabiliyor)').toBe(false);
      return d;
    });
    durum.onayKancasi = () => yayinGeldi({ irsaliyeGonderildi: true });
    await act(async () => { fireEvent.click(irsaliyeDugmesi); });
    await waitFor(() => expect(durum.onaylar.map(x => x.title)).toContain('e-İrsaliye gönderilsin mi?'));
    await waitFor(() => expect(document.body.textContent).toContain('Bu sevkiyat için e-İrsaliye zaten kesildi'));
    expect(istekler.filter(i => `${i.yontem} ${i.yol}` === IRSALIYE)).toHaveLength(0);
  });

  it('İA-2 — başarı + `localUpdateFailed` → «Fatura Mikro\'da kesildi ama sipariş işaretlenemedi — YENİDEN GÖNDERMEYİN»; yerel satıra fatura alanı uydurulmaz, düğme yine kapalı', async () => {
    const c = await ac(siparis());
    durum.yanitlar[KAYDET] = [[200, { success: true, mikroFaturaNo: 'CTP2026000000555', localUpdateFailed: true, mikroFaturaGonderimi: { ...isaretGovdesi('gonderiliyor'), zaman: new Date().toISOString() } }]];
    await act(async () => { fireEvent.click(dugme(c)); });
    await waitFor(() => expect(document.body.textContent).toContain('Fatura Mikro\'da kesildi ama sipariş işaretlenemedi — YENİDEN GÖNDERMEYİN, sayfayı yenileyin.'));
    expect(document.body.textContent).not.toContain('Fatura kaydedildi');
    const yerel = veriDeposu.getState().orders[0];
    expect(yerel.mikroFaturaGonderimi).toMatchObject({ durum: 'gonderiliyor' });
    expect(yerel).not.toHaveProperty('hasInvoice');
    expect(yerel).not.toHaveProperty('mikroFaturaNo');
    await waitFor(() => expect(c.querySelector('[data-mikro-fatura-dugmesi]')).toBeNull());
    expect(kaydetSayisi()).toBe(1);
  });

  it('İ1-4 — «Mikro\'da var» (numarayla) başarısı yerel satıra kaydet başarısıyla AYNI alanları yamar: `hasInvoice`, `mikroSynced`, `mikroFaturaNo`', async () => {
    const o = siparis({ mikroFaturaGonderimi: { durum: 'belirsiz', istekNo: 'istek-1', zaman: '2026-10-17T09:00:00.000Z', kim: 'satis@ornek.test' } });
    window.history.pushState({}, '', '/orders');
    tazele();
    veriDeposu.setState({ orders: [o] });
    const { container: c } = render(<BrowserRouter><App /></BrowserRouter>);
    const satir = await waitFor(() => {
      const s = [...c.querySelectorAll('tr')].find(t => t.textContent?.includes('Şirin Yapı Malzemeleri'));
      if (!s) throw new Error('satır yok');
      return s;
    }, { timeout: 60_000 });
    await act(async () => { fireEvent.click(satir); });
    const uyari = await waitFor(() => {
      const u = c.querySelector<HTMLElement>('[data-fatura-sonucu="sip-fatura-1"]');
      if (!u) throw new Error('uyarı yok');
      return u;
    });
    const girdi = uyari.querySelector('input');
    const varDugmesi = [...uyari.querySelectorAll('button')].find(b => b.textContent === 'Mikro\'da var');
    if (!girdi || !varDugmesi) throw new Error('seçenek yok');
    await act(async () => { fireEvent.change(girdi, { target: { value: 'CTP2026000000999' } }); });
    durum.yanitlar[SONUC] = [[200, { success: true, karar: 'mikrodaVar', numara: 'CTP2026000000999', mikroFaturaGonderimi: { ...isaretGovdesi('gonderildi'), numara: 'CTP2026000000999' } }]];
    await act(async () => { fireEvent.click(varDugmesi); });
    await waitFor(() => expect(sonucSayisi()).toBe(1));
    await waitFor(() => expect(veriDeposu.getState().orders[0]).toMatchObject({ hasInvoice: true, mikroSynced: true, mikroFaturaNo: 'CTP2026000000999', mikroFaturaGonderimi: { durum: 'gonderildi' } }));
    expect(veriDeposu.getState().orders[0]).not.toHaveProperty('mikroFaturaDate');
    // § 9.B B5: ETTN girilmedi — onay metni söyler; gövdede `ettn` YOK; çözümden sonra (`gonderildi`, ETTN yok) «ETTN ekle» çizilir.
    expect(durum.onaylar[durum.onaylar.length - 1].message).toContain('(No: CTP2026000000999 · ETTN girilmedi)');
    expect(JSON.parse(istekler.filter(i => `${i.yontem} ${i.yol}` === SONUC)[0].govde)).toEqual({ firebaseId: 'sip-fatura-1', karar: 'mikrodaVar', numara: 'CTP2026000000999' });
    expect(veriDeposu.getState().orders[0]).not.toHaveProperty('ettn');
    await waitFor(() => expect(c.querySelector('[data-fatura-ettn-ekle="sip-fatura-1"]')).not.toBeNull());
  });
});

describe('§ 9.B B5 / B6 — ETTN uygulama yolundan: «ETTN ekle» ve «Mikro\'da var» + ETTN', () => {
  const ANAHTAR = '1b2c3d4e-0000-4abc-8def-0123456789ab';
  const SIFIR = '00000000-0000-0000-0000-000000000000';
  /** Uygulamayı açar, siparişin satırına tıklayıp ayrıntıya geçer. */
  async function ayrintiyaAc(o: Order): Promise<HTMLElement> {
    window.history.pushState({}, '', '/orders');
    tazele();
    veriDeposu.setState({ orders: [o] });
    const { container: c } = render(<BrowserRouter><App /></BrowserRouter>);
    const satir = await waitFor(() => {
      const t = [...c.querySelectorAll('tr')].find(x => x.textContent?.includes('Şirin Yapı Malzemeleri'));
      if (!t) throw new Error('satır yok');
      return t;
    }, { timeout: 60_000 });
    await act(async () => { fireEvent.click(satir); });
    return c;
  }
  const kesilmis = (ek: Partial<Order> = {}) => siparis({
    hasInvoice: true, mikroSynced: true, mikroFaturaNo: 'CTP2026000000321',
    mikroFaturaGonderimi: { ...isaretGovdesi('gonderildi'), numara: 'CTP2026000000321' } as Order['mikroFaturaGonderimi'], ...ek,
  });
  const ettnKutusu = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-fatura-ettn-ekle="sip-fatura-1"]');
  const sonucGovdeleri = () => istekler.filter(i => `${i.yontem} ${i.yol}` === SONUC).map(i => JSON.parse(i.govde) as unknown);

  it('sıfır GUID\'li `gonderildi` siparişte «ETTN ekle» görünür; Vazgeç → istek yok; onay → gövdede ANAHTAR; yayın gelmeden yerelde YANITTAKİ `ettn`, düğme kaybolur, rozet, ileti', async () => {
    const c = await ayrintiyaAc(kesilmis({ ettn: SIFIR }));
    const kutu = await waitFor(() => { const k = ettnKutusu(c); if (!k) throw new Error('«ETTN ekle» yok'); return k; });
    expect(c.querySelector('[data-fatura-ettn]')).toBeNull();   // sıfır GUID geçerli ETTN değil: rozet yok
    const girdi = kutu.querySelector<HTMLInputElement>('input[aria-label="Mikro ETTN"]');
    const dugme = kutu.querySelector<HTMLButtonElement>('[data-fatura-ettn-ekle-dugmesi]');
    if (!girdi || !dugme) throw new Error('girdi / düğme yok');
    await act(async () => { fireEvent.change(girdi, { target: { value: `{${ANAHTAR.toLocaleUpperCase('tr-TR')}}` } }); });
    durum.onayKarari = false;
    await act(async () => { fireEvent.click(dugme); });
    await waitFor(() => expect(durum.onaylar).toHaveLength(1));
    expect(sonucSayisi()).toBe(0);
    expect(durum.onaylar[0]).toMatchObject({ title: 'ETTN eklensin mi?', variant: 'warning', confirmLabel: 'ETTN ekle' });
    expect(durum.onaylar[0].message).toContain('Şirin Yapı Malzemeleri');
    expect(durum.onaylar[0].message).toContain('No: CTP2026000000321');
    expect(durum.onaylar[0].message).toContain(`ETTN: ${ANAHTAR}`);
    durum.onayKarari = true;
    durum.yanitlar[SONUC] = [[200, { success: true, karar: 'ettnEkle', ettn: ANAHTAR, mikroFaturaGonderimi: { ...isaretGovdesi('gonderildi'), numara: 'CTP2026000000321' } }]];
    await act(async () => { fireEvent.click(dugme); });
    await waitFor(() => expect(sonucSayisi()).toBe(1));
    expect(sonucGovdeleri()).toEqual([{ firebaseId: 'sip-fatura-1', karar: 'ettnEkle', ettn: ANAHTAR }]);
    await waitFor(() => expect(veriDeposu.getState().orders[0].ettn).toBe(ANAHTAR));
    await waitFor(() => expect(ettnKutusu(c)).toBeNull());
    expect(c.querySelector('[data-fatura-ettn="sip-fatura-1"]')?.textContent).toBe(`ETTN: ${ANAHTAR}`);
    expect(veriDeposu.getState().orders[0]).toMatchObject({ mikroFaturaNo: 'CTP2026000000321', mikroFaturaGonderimi: { durum: 'gonderildi' } });
    await waitFor(() => expect(document.body.textContent).toContain('ETTN eklendi: fatura bu siparişe bağlandı.'));
  });

  it('yerel yama YANITTAN: yanıt `ettn` taşımazsa (eski sunucu / vekil) yerelde ETTN YAZILMAZ — girdi uydurulmaz, düğme kalır', async () => {
    const c = await ayrintiyaAc(kesilmis());
    const kutu = await waitFor(() => { const k = ettnKutusu(c); if (!k) throw new Error('«ETTN ekle» yok'); return k; });
    const girdi = kutu.querySelector<HTMLInputElement>('input[aria-label="Mikro ETTN"]');
    const dugme = kutu.querySelector<HTMLButtonElement>('[data-fatura-ettn-ekle-dugmesi]');
    if (!girdi || !dugme) throw new Error('girdi / düğme yok');
    await act(async () => { fireEvent.change(girdi, { target: { value: ANAHTAR } }); });
    durum.yanitlar[SONUC] = [[200, { success: true, karar: 'ettnEkle', mikroFaturaGonderimi: isaretGovdesi('gonderildi') }]];
    await act(async () => { fireEvent.click(dugme); });
    await waitFor(() => expect(sonucSayisi()).toBe(1));
    await waitFor(() => expect(document.body.textContent).toContain('ETTN eklendi'));
    expect(veriDeposu.getState().orders[0]).not.toHaveProperty('ettn');
    expect(ettnKutusu(c)).not.toBeNull();
  });

  it('409 FATURA_ETTN_BASKA_SIPARISTE → ileti (öteki siparişle), yerel ETTN değişmez; sonra 200 + `uyari` → bilgi iletisi', async () => {
    const c = await ayrintiyaAc(kesilmis());
    const kutu = await waitFor(() => { const k = ettnKutusu(c); if (!k) throw new Error('«ETTN ekle» yok'); return k; });
    const girdi = kutu.querySelector<HTMLInputElement>('input[aria-label="Mikro ETTN"]');
    const dugme = kutu.querySelector<HTMLButtonElement>('[data-fatura-ettn-ekle-dugmesi]');
    if (!girdi || !dugme) throw new Error('girdi / düğme yok');
    await act(async () => { fireEvent.change(girdi, { target: { value: ANAHTAR } }); });
    durum.yanitlar[SONUC] = [
      [409, { success: false, kod: 'FATURA_ETTN_BASKA_SIPARISTE', error: 'Bu ETTN başka bir siparişte kayıtlı: S-12', mikroFaturaGonderimi: isaretGovdesi('gonderildi') }],
      [200, { success: true, karar: 'ettnEkle', ettn: ANAHTAR, uyari: 'ETTN Mikro fatura aynasında henüz yok ya da carisi doğrulanamadı (ayna gece güncellenir)', mikroFaturaGonderimi: isaretGovdesi('gonderildi') }],
    ];
    await act(async () => { fireEvent.click(dugme); });
    await waitFor(() => expect(document.body.textContent).toContain('ETTN yazılmadı. Bu ETTN başka bir siparişte kayıtlı: S-12. Mikro\'daki ETTN\'yi denetleyin.'));
    expect(veriDeposu.getState().orders[0]).not.toHaveProperty('ettn');
    expect(ettnKutusu(c)).not.toBeNull();
    await act(async () => { fireEvent.click(dugme); });
    await waitFor(() => expect(document.body.textContent).toContain('ETTN kaydedildi ama Mikro fatura aynasında henüz yok ya da carisi doğrulanamadı'));
    await waitFor(() => expect(ettnKutusu(c)).toBeNull());
  });

  it('«Mikro\'da var» + ETTN (belirsiz): onay metninde « · ETTN: <anahtar>», gövdede anahtar, yerelde YANITTAKİ `ettn` + fatura alanları; «ETTN ekle» çizilmez', async () => {
    const c = await ayrintiyaAc(siparis({ mikroFaturaGonderimi: isaretGovdesi('belirsiz') as Order['mikroFaturaGonderimi'] }));
    const uyari = await waitFor(() => { const u = c.querySelector<HTMLElement>('[data-fatura-sonucu="sip-fatura-1"]'); if (!u) throw new Error('uyarı yok'); return u; });
    const numara = uyari.querySelector<HTMLInputElement>('input[aria-label="Mikro fatura numarası (isteğe bağlı)"]');
    const ettn = uyari.querySelector<HTMLInputElement>('input[aria-label="Mikro ETTN (isteğe bağlı)"]');
    const varDugmesi = [...uyari.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Mikro\'da var');
    if (!numara || !ettn || !varDugmesi) throw new Error('seçenek yok');
    await act(async () => {
      fireEvent.change(numara, { target: { value: 'CTP2026000000444' } });
      fireEvent.change(ettn, { target: { value: ` {${ANAHTAR.toLocaleUpperCase('tr-TR')}}` } });
    });
    durum.yanitlar[SONUC] = [[200, { success: true, karar: 'mikrodaVar', numara: 'CTP2026000000444', ettn: ANAHTAR, mikroFaturaGonderimi: { ...isaretGovdesi('gonderildi'), numara: 'CTP2026000000444' } }]];
    await act(async () => { fireEvent.click(varDugmesi); });
    await waitFor(() => expect(sonucSayisi()).toBe(1));
    expect(durum.onaylar[0].message).toContain(`(No: CTP2026000000444 · ETTN: ${ANAHTAR})`);
    expect(sonucGovdeleri()).toEqual([{ firebaseId: 'sip-fatura-1', karar: 'mikrodaVar', numara: 'CTP2026000000444', ettn: ANAHTAR }]);
    await waitFor(() => expect(veriDeposu.getState().orders[0]).toMatchObject({ hasInvoice: true, mikroSynced: true, mikroFaturaNo: 'CTP2026000000444', ettn: ANAHTAR, mikroFaturaGonderimi: { durum: 'gonderildi' } }));
    await waitFor(() => expect(c.querySelector('[data-fatura-ettn="sip-fatura-1"]')?.textContent).toBe(`ETTN: ${ANAHTAR}`));
    expect(ettnKutusu(c)).toBeNull();
    expect(c.querySelector('[data-fatura-sonucu]')).toBeNull();
  });

  it('İngilizce onay metni ETTN girilmeyince « · ETTN not entered»', async () => {
    const c = await ayrintiyaAc(siparis({ mikroFaturaGonderimi: isaretGovdesi('belirsiz') as Order['mikroFaturaGonderimi'] }));
    const dil = [...c.querySelectorAll<HTMLButtonElement>('button')].find(x => x.textContent?.trim() === 'EN');
    if (!dil) throw new Error('dil düğmesi yok');
    await act(async () => { fireEvent.click(dil); });
    const uyari = await waitFor(() => { const u = c.querySelector<HTMLElement>('[data-fatura-sonucu="sip-fatura-1"]'); if (!u) throw new Error('uyarı yok'); return u; });
    const varDugmesi = [...uyari.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'It is in Mikro');
    if (!varDugmesi) throw new Error('seçenek yok');
    durum.onayKarari = false;
    await act(async () => { fireEvent.click(varDugmesi); });
    await waitFor(() => expect(durum.onaylar).toHaveLength(1));
    expect(durum.onaylar[0].message).toContain('(no number entered · ETTN not entered)');
  });
});
