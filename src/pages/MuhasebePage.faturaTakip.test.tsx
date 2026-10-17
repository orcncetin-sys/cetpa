// @vitest-environment jsdom
/**
 * MuhasebePage.faturaTakip.test.tsx — Muhasebe → e-Fatura Takip tablosu, GERÇEK `App.tsx` + GERÇEK `MuhasebePage` (2026-10-17,
 * şartname «e-Fatura çift kesim» § 7.4 B8; D12).
 *
 * NEDEN: tablo «faturası var mı» kararını eskiden üç alandan (`hasInvoice`, Mikro / LUCA numarası) kendisi veriyordu. Gönderimi
 * süren ya da sonucu bilinmeyen e-Fatura «Fatura yok» sayılıyor ve satırda «Faturalandı» düğmesi çiziliyordu — o düğme yalnız
 * `hasInvoice` yazar, işareti çözmez; kullanıcı belgenin kesilip kesilmediğini bilmeden siparişi «faturalandı» diye kapatırdı.
 * Saf yüklem (`faturaTakipFaturaVar`) tek başına sınanmıştı (faturaDurumu.gonderim.test); burada tablonun ONA bağlı olduğu
 * («yazıldı ama bağlanmadı» çiti) kullanıcının gördüğü ekrandan sınanır: «Fatura Eksik» süzgeci, sayacı, satır rozeti, düğme.
 *
 * Sahte olanlar YALNIZ dış dünya (MikroFatura.uygulama.test.tsx kalıbı): Firebase kimliği, `fetch`, `EventSource`. Sipariş
 * listesi veri deposuna doğrudan konur. Ekran menüden açılır (Muhasebe → «e-Fatura Takip»).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type React from 'react';
import type { Order } from '../types';
import type { MikroFaturaGonderimi } from '../lib/faturaGonderimi';

vi.setConfig({ testTimeout: 90_000 });

const durum = vi.hoisted(() => ({
  kullanici: {
    uid: 'uid-takip-1', email: 'yonetici@ornek.test', displayName: 'Yönetici', photoURL: '', isAnonymous: false,
    emailVerified: true, tenantId: null, providerData: [], getIdToken: async () => 'belirtec-deneme',
  },
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

const yanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });
const KENDI = `/api/db/users/${'uid-takip-1'}`;
function sahteFetch(girdi: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ham = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
  const basliklar = (init?.headers ?? {}) as Record<string, string>;
  const yontem = (basliklar['X-Cetpa-Method'] ?? init?.method ?? 'GET').toUpperCase();
  const yol = ham.split('?')[0];
  if (yol === '/api/mfa/status') return Promise.resolve(yanit({ enabled: false, verified: false }));
  if (yol === KENDI && yontem === 'GET') return Promise.resolve(yanit({ data: { role: 'Admin', companyId: 'sirket-1', name: 'Yönetici' } }));
  if (yol === '/api/superadmin/me') return Promise.resolve(yanit({ isSuperAdmin: false }));
  if (yol === '/api/settings/exchange-rates') return Promise.resolve(yanit({ rates: { USD: 40, EUR: 45 } }));
  if (yol.startsWith('/api/db/') && yontem === 'GET' && yol.split('/').length === 4) return Promise.resolve(yanit({ docs: [] }));
  return Promise.resolve(yanit({}));
}
class SahteAkis { static CLOSED = 2; readyState = 0; onerror: (() => void) | null = null; addEventListener(): void {} close(): void { this.readyState = 2; } }

const isaret = (d: MikroFaturaGonderimi['durum'], zaman = new Date().toISOString()): MikroFaturaGonderimi =>
  ({ durum: d, istekNo: `istek-${d}`, zaman, kim: 'satis@ornek.test' });
const siparis = (id: string, customerName: string, ek: Partial<Order> = {}): Order => ({
  id, customerName, totalPrice: 15000, status: 'Processing', customerType: 'B2B', orderNumber: id, lineItems: [], faturali: true,
  faturaTipi: 'e-arsiv', kdvOran: 20, companyId: 'sirket-1', createdAt: '2026-10-17T09:00:00.000Z', ...ek,
} as Order);

/** Ad → beklenen: «faturası var» mı, satırdaki gönderim rozeti (yoksa `null`). */
const SIPARISLER: Array<[Order, boolean, string | null]> = [
  [siparis('t-isaretsiz', 'Akasya İnşaat'), false, null],
  [siparis('t-reddedildi', 'Begonya Yapı', { mikroFaturaGonderimi: isaret('reddedildi') }), false, 'Mikro reddetti'],
  [siparis('t-belirsiz', 'Çınar Malzeme', { mikroFaturaGonderimi: isaret('belirsiz') }), true, 'Fatura sonucu bilinmiyor'],
  [siparis('t-gonderiliyor', 'Defne Hırdavat', { mikroFaturaGonderimi: isaret('gonderiliyor') }), true, 'Fatura gönderiliyor'],
  [siparis('t-numarasiz', 'Erguvan Seramik', { mikroFaturaGonderimi: isaret('gonderildi') }), true, 'Fatura kesildi (numara okunamadı)'],
  [siparis('t-bayat', 'Fesleğen Yalıtım', { mikroFaturaGonderimi: isaret('gonderiliyor', '2026-01-01T00:00:00.000Z') }), true, 'Fatura sonucu bilinmiyor'],
];

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
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(sahteFetch));
  vi.stubGlobal('EventSource', SahteAkis);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Muhasebe sayfasını açar ve menüden «e-Fatura Takip»e geçer. */
async function takipAc(): Promise<HTMLElement> {
  window.history.pushState({}, '', '/muhasebe');
  tazele();
  veriDeposu.setState({ orders: SIPARISLER.map(([o]) => o) });
  const { container } = render(<BrowserRouter><App /></BrowserRouter>);
  const menu = await waitFor(() => {
    const d = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'e-Fatura Takip');
    if (!d) throw new Error('«e-Fatura Takip» menü öğesi yok');
    return d;
  }, { timeout: 60_000 });
  await act(async () => { fireEvent.click(menu); });
  // Tembel panel parçası tam paket yükünde 1 sn'yi aşabiliyor (2026-10-17 tam koşuda ölçüldü): menü beklemesiyle aynı tavan.
  await waitFor(() => expect(container.textContent).toContain('Fatura Eksik'), { timeout: 60_000 });
  return container;
}
const satir = (c: HTMLElement, ad: string): HTMLTableRowElement | undefined =>
  [...c.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(t => t.textContent?.includes(ad));
const satirAdlari = (c: HTMLElement): string[] =>
  SIPARISLER.map(([o]) => o.customerName).filter(ad => satir(c, ad) !== undefined);
const faturalandiDugmesi = (tr: HTMLTableRowElement | undefined): HTMLButtonElement | undefined =>
  tr ? [...tr.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Faturalandı') : undefined;
const suzgec = (c: HTMLElement, etiket: string): HTMLButtonElement => {
  const d = [...c.querySelectorAll('button')].find(b => b.firstChild?.textContent?.trim() === etiket);
  if (!d) throw new Error(`süzgeç yok: ${etiket}`);
  return d;
};

describe('B8 (D12) — Muhasebe e-Fatura Takip: gönderimi süren / sonucu bilinmeyen fatura «Fatura yok» SAYILMAZ', () => {
  it('«Fatura Eksik» süzgeci ve sayacı yalnız işaretsiz ve reddedilen siparişi sayar', async () => {
    const c = await takipAc();
    const beklenen = SIPARISLER.filter(([, var_]) => !var_).map(([o]) => o.customerName);
    await waitFor(() => expect(satirAdlari(c)).toEqual(beklenen));
    expect(suzgec(c, 'Fatura Eksik').querySelector('span')?.textContent).toBe(String(beklenen.length));
  });

  it('«Tümü»: gönderim rozeti satırda çizilir; «Faturalandı» düğmesi yalnız faturası OLMAYAN satırda (işaretli satırda YOK)', async () => {
    const c = await takipAc();
    await act(async () => { fireEvent.click(suzgec(c, 'Tümü')); });
    await waitFor(() => expect(satirAdlari(c)).toHaveLength(SIPARISLER.length));
    for (const [o, faturaVar, rozet] of SIPARISLER) {
      const tr = satir(c, o.customerName);
      expect(tr?.querySelector(`[data-fatura-durumu="${o.id}"]`)?.textContent ?? null, `${o.customerName} rozeti`).toBe(rozet);
      expect(faturalandiDugmesi(tr) !== undefined, `${o.customerName} «Faturalandı» düğmesi`).toBe(!faturaVar);
      if (!rozet) expect(tr?.textContent, o.customerName).toContain('Fatura Yok');
    }
  });
});

/** Açık ayrıntı penceresinin sipariş kimliği (başlığın altındaki satır); pencere yoksa `null`. */
const pencereKimligi = (c: HTMLElement): string | null =>
  [...c.querySelectorAll('h3')].find(h => h.textContent?.trim() === 'Fatura / Sipariş Detayı')?.nextElementSibling?.textContent ?? null;

describe('İ1-5 — «Bekliyor» ve ayrıntı penceresi AYNI yüklemden (inceleme 1)', () => {
  it('«Bekliyor» süzgeci ve sayacı: faturası VAR sayılan (gönderiliyor / bayat / belirsiz / numarasız kesilen) ve senkronsuz sipariş; eskiden yalnız `hasInvoice` sayılıyordu', async () => {
    const c = await takipAc();
    await act(async () => { fireEvent.click(suzgec(c, 'Bekliyor')); });
    // Hiçbiri `hasInvoice` taşımıyor ve senkronsuz: «Bekliyor» = «faturası var» kümesinin TAMAMI.
    const beklenen = SIPARISLER.filter(([, var_]) => var_).map(([o]) => o.customerName);
    expect(beklenen.length).toBeGreaterThan(0);
    await waitFor(() => expect(satirAdlari(c)).toEqual(beklenen));
    expect(suzgec(c, 'Bekliyor').querySelector('span')?.textContent).toBe(String(beklenen.length));
    // KPI şeridindeki «Fatura Bekliyor» da AYNI sayı (süzgeç ile sayaç tek işlevden).
    const kpi = [...c.querySelectorAll('p')].find(p => p.textContent?.trim() === 'Fatura Bekliyor');
    expect(kpi?.nextElementSibling?.textContent).toBe(String(beklenen.length));
  });

  it('ayrıntı penceresinin «ERP durumu» rozeti satırdakiyle AYNI metin (`mikroFaturaDurumMetni` dalı); işaretsiz siparişte rozet yok', async () => {
    const c = await takipAc();
    await act(async () => { fireEvent.click(suzgec(c, 'Tümü')); });
    await waitFor(() => expect(satirAdlari(c)).toHaveLength(SIPARISLER.length));
    for (const [o, , rozet] of SIPARISLER) {
      const tr = satir(c, o.customerName);
      if (!tr) throw new Error(`satır yok: ${o.customerName}`);
      await act(async () => { fireEvent.click(tr); });
      await waitFor(() => expect(pencereKimligi(c)).toBe(o.id));   // pencere başlığında sipariş kimliği
      const satirRozeti = tr.querySelector(`[data-fatura-durumu="${o.id}"]`)?.textContent ?? null;
      const ayrinti = c.querySelector(`[data-fatura-durumu-ayrinti="${o.id}"]`)?.textContent ?? null;
      expect(ayrinti, `${o.customerName} ayrıntı rozeti`).toBe(rozet);
      expect(ayrinti, `${o.customerName} satır = ayrıntı`).toBe(satirRozeti);
    }
  });
});
