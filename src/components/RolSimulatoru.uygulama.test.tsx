// @vitest-environment jsdom
/**
 * RolSimulatoru.uygulama.test.tsx — Yönetim → Kullanıcılar'daki «Rol Simülatörü», UYGULAMA düzeyinde (2026-10-17; iç rol şartnamesi
 * `.wf/SARTNAME-ic-rol-daraltma.md` § 8 «Bilinen sınır»ın kalıcı çözümü — yayin17 birleşme incelemesi bulgu 1).
 *
 * Değişmezler:
 *   1. Simülatör İKİ rol kaynağını BİRLİKTE değiştirir: App'in yerel rolü (prop'tan okuyan kapılar, sekme tablosu) ve küresel depo
 *      (depodan okuyan kapılar — burada Satış Ajanı paneli). Eskiden yalnız yerel rol değişiyordu: depodan okuyan panel simülasyonda
 *      GERÇEK rolle çiziliyordu, aynı ekranda iki rol vardı.
 *   2. Arka plan Mikro yeniden deneme zamanlayıcısı simülasyondan ETKİLENMEZ: oturumun gerçek rolüyle koşar (simülasyon yalnız
 *      arayüzdür; sunucu da gerçek role bakar). Simülasyon başlayınca zamanlayıcı yeniden kurulmaz, süzgeci değişmez; dış rol
 *      seçilse de durmaz.
 *   3. Gerçek rol kaydı OTURUMA bağlıdır: oturum kapanıp yeniden açılınca (açılış turu değişir) kayıt geçersizdir — zamanlayıcı yeni
 *      oturumun rolüyle koşar.
 * Ayrıca: simüle rolün geçtiği HER istemci kapısından Yönetici de geçer (simülatörü yalnız Yönetici açar) — simülasyonda atılan
 * istek sunucunun gerçek rol yetkisinde 403 almaz.
 *
 * DÜZENEK `KayitKapanisi.uygulama.test.tsx` ile AYNI kalıp: GERÇEK `App.tsx` çizilir; sahte olanlar YALNIZ dış dünya — Firebase
 * kimliği (`firebase/auth`, `../firebase`), `fetch`, `EventSource`, zaman. `lib/dbClient` gerçektir. Tembel sayfalar (`React.lazy`)
 * boş çizilir; tek fark: `setUserRole` alan tembel sayfa (Yönetim sayfası — App'te bu niteliği alan TEK sayfa, çit aşağıda)
 * simülatörün düğmelerini çizer ve App'in verdiği ayarlayıcıyı AYNEN çağırır.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type React from 'react';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';
import { APP_ROLES, KURALLI_KOLEKSIYONLAR, isAllowed, type DbOp } from '../lib/rbac';
import { MIKRO_UC_KAPILARI, ucKapisindanGecer, type MikroKapiliUc } from '../lib/mikroUcKapilari';
import { ENTEGRASYON_UC_KAPILARI, entegrasyonUcKapisindanGecer, type EntegrasyonKapiliUc } from '../lib/entegrasyonUcKapilari';
import { MIKRO_EVRAK_KAPILARI, evrakKapisindanGecer } from '../lib/mikroEvrakKapilari';
import { useAppStore } from '../store/appStore';
import SatisAjaniPanel from './SatisAjaniPanel';

const UID = 'uid-simulator-1';
// Gerçek App çizilir; yük altında (bütün takım koşarken) tek açılış saniyeyi bulabilir.
vi.setConfig({ testTimeout: 60_000 });

interface SahteKullanici {
  uid: string; email: string; displayName: string; photoURL: string; isAnonymous: boolean; emailVerified: boolean;
  tenantId: null; providerData: unknown[]; getIdToken: () => Promise<string>;
}
const durum = vi.hoisted(() => ({
  /** `users/<uid>` belgesindeki rol (sunucunun bildiği GERÇEK rol). */
  rol: 'Admin',
  hesap: null as SahteKullanici | null,
  yuklendi: false,
  oturumDinleyicisi: null as ((u: unknown) => void | Promise<void>) | null,
  /** `GET /api/db/syncJobs` yanıtındaki işler. */
  isler: [] as Array<Record<string, unknown> & { id: string }>,
  /** Yönetim sayfasının SON çiziminde App'in verdiği simülatör ayarlayıcısı. */
  simulator: null as ((r: string) => void) | null,
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ get currentUser() { return durum.yuklendi ? durum.hesap : null; } }),
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void | Promise<void>) => {
    durum.oturumDinleyicisi = cb;
    queueMicrotask(() => { durum.yuklendi = true; void cb(durum.hesap); });
    return () => {};
  },
  signOut: async () => {},
  deleteUser: async () => {},
  getRedirectResult: async () => null,
  GoogleAuthProvider: class { setCustomParameters() {} },
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), signInWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(), sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: {
    get currentUser() { return durum.yuklendi ? durum.hesap : null; },
    onAuthStateChanged: (cb: (u: unknown) => void) => { queueMicrotask(() => { durum.yuklendi = true; cb(durum.hesap); }); return () => {}; },
  },
}));
vi.mock('react', async (asilAl) => {
  const asil = await asilAl<typeof import('react') & { default: typeof import('react') }>();
  // Tembel sayfalar boş; yalnız Yönetim sayfası (`setUserRole` alan TEK tembel sayfa) simülatör düğmelerini çizer.
  const lazy = () => (p: { setUserRole?: (r: string) => void; userRole?: string }) => {
    const ayarla = p.setUserRole;
    if (typeof ayarla !== 'function') return null;
    durum.simulator = ayarla;
    return asil.createElement('div', { 'data-testid': 'yonetim-sayfasi', 'data-yerel-rol': p.userRole },
      ...['Admin', 'Purchasing', 'Dealer'].map(r => asil.createElement('button', { key: r, type: 'button', onClick: () => ayarla(r) }, `Simüle et: ${r}`)));
  };
  return { ...asil, lazy, default: { ...asil.default, lazy } };
});

interface Istek { yontem: string; yol: string; govde: unknown }
let istekler: Istek[] = [];

const yanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });

/** Sunucunun yerine geçen en küçük yanıtlayıcı. Yöntem, IIS tünelindeki asıl yöntemdir (`X-Cetpa-Method`). */
function sahteFetch(girdi: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ham = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
  const basliklar = (init?.headers ?? {}) as Record<string, string>;
  const yontem = (basliklar['X-Cetpa-Method'] ?? init?.method ?? 'GET').toUpperCase();
  const yol = ham.split('?')[0];
  let govde: unknown;
  try { govde = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined; } catch { govde = init?.body; }
  istekler.push({ yontem, yol, govde });
  if (yol === '/api/mfa/status') return Promise.resolve(yanit({ enabled: false, verified: false }));
  if (yol === `/api/db/users/${UID}` && yontem === 'GET') return Promise.resolve(yanit({ data: { role: durum.rol, companyId: 'sirket-1', name: 'Deneme Yönetici' } }));
  if (yol === '/api/superadmin/me') return Promise.resolve(yanit({ isSuperAdmin: false }));
  if (yol === '/api/settings/exchange-rates') return Promise.resolve(yanit({ rates: { USD: 40, EUR: 45 } }));
  if (yol === '/api/db/syncJobs' && yontem === 'GET') return Promise.resolve(yanit({ docs: durum.isler.map(j => ({ id: j.id, data: j })) }));
  if (yol.startsWith('/api/db/syncJobs/') && yol.endsWith('/cas')) return Promise.resolve(yanit({ claimed: true }));
  if (yol === '/api/mikro/evrak/kaydet' && yontem === 'POST') return Promise.resolve(yanit({ success: true }));
  if (yol.startsWith('/api/db/') && yontem === 'GET' && yol.split('/').length === 4) return Promise.resolve(yanit({ docs: [] }));
  return Promise.resolve(yanit({}));
}

class SahteAkis {
  static CLOSED = 2;
  readyState = 0;
  onerror: (() => void) | null = null;
  addEventListener(): void {}
  close(): void { this.readyState = 2; }
}

const SIMDI = new Date('2026-10-17T09:00:00+03:00');
const KULLANICI: SahteKullanici = {
  uid: UID, email: 'yonetici@ornek.test', displayName: 'Deneme Yönetici', photoURL: '', isAnonymous: false, emailVerified: true,
  tenantId: null, providerData: [], getIdToken: async () => 'belirtec-deneme',
};

let App: React.ComponentType;
let tazele: () => void;
beforeAll(async () => {
  App = (await import('../App')).default;
  const { resetStream } = await import('../lib/dbClient');
  const { resetLazyCollections } = await import('../lib/lazyCollections');
  tazele = () => { resetStream(); resetLazyCollections(); useAppStore.setState(useAppStore.getInitialState()); };
}, 180_000);

beforeEach(() => {
  istekler = [];
  durum.rol = 'Admin'; durum.hesap = null; durum.yuklendi = false; durum.oturumDinleyicisi = null; durum.isler = []; durum.simulator = null;
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(SIMDI);
  vi.stubGlobal('fetch', vi.fn(sahteFetch));
  vi.stubGlobal('EventSource', SahteAkis);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Akış bağlantısı abonelikten 400 ms sonra açılır; 2 sn her açılış efektini ve o gecikmeyi kapsar. */
const bekle = (ms = 2_000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

/** Uygulamayı Yönetici hesabıyla, Yönetim sekmesinde açar (simülatör orada). */
async function yoneticiOlarakAc() {
  durum.hesap = KULLANICI; durum.yuklendi = false;
  window.history.pushState({}, '', '/admin');
  tazele();
  const sonuc = render(<BrowserRouter><App /></BrowserRouter>);
  await bekle();
  expect(sonuc.queryByTestId('yonetim-sayfasi')?.getAttribute('data-yerel-rol')).toBe('Admin');   // düzenek canlı
  expect(useAppStore.getState().userRole).toBe('Admin');
  return sonuc;
}
async function simuleEt(sonuc: ReturnType<typeof render>, rol: string) {
  fireEvent.click(sonuc.getByText(`Simüle et: ${rol}`));
  await bekle();
}
const depoRolu = () => useAppStore.getState().userRole;
/** Kabuktaki «Yönetim» menü öğesi yalnız YEREL rol Yönetici iken çizilir (App.tsx menü tanımı) — yerel rolün ekrandaki izi. */
const yonetimMenusuVar = (kap: HTMLElement) => [...kap.querySelectorAll('button, a')].some(b => (b.textContent ?? '').trim() === 'Yönetim');
const satisAjani = () => render(<SatisAjaniPanel currentLanguage="tr" aiOnayli={false} musteriler={[]} />);
/** Yeniden deneme yürütücüsünün Mikro'ya gönderdiği işler (yöntem adı). */
const mikroGonderimleri = () => istekler.filter(i => i.yol === '/api/mikro/evrak/kaydet').map(i => (i.govde as { method?: string }).method);
/** Bu oturumun KENDİ işi (sahip damgası + belge kimliği soneki): yalnız rol süzgeci ayırt eder. */
const kendiIsi = (method: string) => ({
  id: `mikro_${method}_varlik-1_${UID}`, type: 'mikro', payload: { method, payload: {}, meta: {} }, status: 'queued',
  attempts: 0, maxAttempts: 5, nextRetryAt: SIMDI.getTime() - 1_000, createdAt: SIMDI.getTime() - 60_000,
  updatedAt: SIMDI.getTime() - 60_000, sahipUid: UID,
});

// ═══ 1 — iki kaynak birlikte ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('Rol Simülatörü — yerel rol ve depo BİRLİKTE değişir', () => {
  it('depo Yönetici, simülatör Satın Alma: depo da Satın Alma, Satış Ajanı ÇİZİLMEZ; Yönetici\'ye dönünce yeniden çizilir', async () => {
    const sonuc = await yoneticiOlarakAc();
    const panel = satisAjani();
    expect(panel.container.textContent).toContain('AI Satış Ajanı');
    expect(yonetimMenusuVar(sonuc.container)).toBe(true);

    await simuleEt(sonuc, 'Purchasing');
    expect(depoRolu()).toBe('Purchasing');                     // depo (eskiden Yönetici kalıyordu)
    expect(panel.container.textContent).toBe('');              // Y2: Satın Alma kilitli — panel çizilmez
    expect(yonetimMenusuVar(sonuc.container)).toBe(false);     // yerel rol de Satın Alma
    // Yönetim sekmesi yalnız Yönetici'nin: sekme kapısı panoya yönlendirdi — simülatör (ve «Yönetici» düğmesi) artık ekranda YOK.
    expect(sonuc.queryByTestId('yonetim-sayfasi')).toBeNull();

    // «Yönetici» düğmesi aynı ayarlayıcıyı çağırır: son çizimin ayarlayıcısıyla geri dönülür.
    const ayarla = durum.simulator;
    expect(ayarla).not.toBeNull();
    await act(async () => { ayarla?.('Admin'); });
    await bekle();
    expect(depoRolu()).toBe('Admin');
    expect(panel.container.textContent).toContain('AI Satış Ajanı');
    expect(yonetimMenusuVar(sonuc.container)).toBe(true);
  });

  it('dış rol (Bayi) simülasyonunda depo da Bayi', async () => {
    const sonuc = await yoneticiOlarakAc();
    await simuleEt(sonuc, 'Dealer');
    expect(depoRolu()).toBe('Dealer');
  });
});

// ═══ 2 — arka plan kuyruğu simülasyondan etkilenmez ════════════════════════════════════════════════════════════════════════
describe('Mikro yeniden deneme zamanlayıcısı — oturumun GERÇEK rolüyle koşar', () => {
  it('Satın Alma simülasyonunda Yönetici\'nin gönderebildiği (Satın Alma\'nın gönderemediği) dekont işi bir sonraki turda GİDER', async () => {
    const sonuc = await yoneticiOlarakAc();
    await simuleEt(sonuc, 'Purchasing');
    expect(depoRolu()).toBe('Purchasing');
    expect(evrakKapisindanGecer('Purchasing', 'DekontKaydetV2')).toBe(false);   // süzgeç ayırt eder (öncül)
    expect(evrakKapisindanGecer('Admin', 'DekontKaydetV2')).toBe(true);
    durum.isler = [kendiIsi('DekontKaydetV2')];
    await bekle(90_000);
    expect(mikroGonderimleri()).toEqual(['DekontKaydetV2']);
  });

  it('simülasyon başlayınca zamanlayıcı yeniden KURULMAZ (simülasyon anında kuyruk okunmaz)', async () => {
    const sonuc = await yoneticiOlarakAc();
    const okumalar = () => istekler.filter(i => i.yol === '/api/db/syncJobs' && i.yontem === 'GET').length;
    const once = okumalar();
    expect(once).toBeGreaterThan(0);   // açılışta bir tur koştu (düzenek canlı)
    await simuleEt(sonuc, 'Purchasing');
    expect(okumalar()).toBe(once);
  });

  it('Bayi simülasyonunda (dış rol) zamanlayıcı DURMAZ', async () => {
    const sonuc = await yoneticiOlarakAc();
    await simuleEt(sonuc, 'Dealer');
    expect(depoRolu()).toBe('Dealer');
    durum.isler = [kendiIsi('DekontKaydetV2')];
    await bekle(90_000);
    expect(mikroGonderimleri()).toEqual(['DekontKaydetV2']);
  });

  it('gerçek rol kaydı OTURUMA bağlı: oturum kapanıp Satış rolüyle yeniden açılınca zamanlayıcı Satış rolüyle koşar', async () => {
    const sonuc = await yoneticiOlarakAc();
    await simuleEt(sonuc, 'Purchasing');
    // Oturum kapanır (başka sekmeden çıkış gibi) — iki kaynak birlikte açılış varsayılanına döner.
    await act(async () => { await durum.oturumDinleyicisi?.(null); });
    await bekle();
    expect(depoRolu()).toBe('Sales');
    // Aynı hesap, rolü artık Satış: yeni açılış turu.
    durum.rol = 'Sales';
    await act(async () => { await durum.oturumDinleyicisi?.(KULLANICI); });
    await bekle();
    expect(depoRolu()).toBe('Sales');
    expect(evrakKapisindanGecer('Sales', 'DekontKaydetV2')).toBe(false);
    expect(evrakKapisindanGecer('Sales', 'ZiyaretKaydetV2')).toBe(true);
    durum.isler = [kendiIsi('DekontKaydetV2'), kendiIsi('ZiyaretKaydetV2')];
    await bekle(90_000);
    // Satış'ın gönderebildiği iş gider (zamanlayıcı kurulu), gönderemediği GİTMEZ (eski oturumun Yönetici kaydı kullanılmadı).
    expect(mikroGonderimleri()).toEqual(['ZiyaretKaydetV2']);
    expect(sonuc.queryByTestId('yonetim-sayfasi')).toBeNull();
  });
});

// ═══ 3 — simülasyonda atılan istek 403 almaz ═══════════════════════════════════════════════════════════════════════════════
describe('simüle rolün geçtiği her istemci kapısından Yönetici de geçer (simülatörü yalnız Yönetici açar)', () => {
  it('Mikro uç, Mikro evrak, entegrasyon uç tabloları ve koleksiyon kuralları', () => {
    const kacak: string[] = [];
    for (const rol of APP_ROLES) {
      for (const uc of Object.keys(MIKRO_UC_KAPILARI) as MikroKapiliUc[]) if (ucKapisindanGecer(rol, uc) && !ucKapisindanGecer('Admin', uc)) kacak.push(`${rol} ${uc}`);
      for (const uc of Object.keys(ENTEGRASYON_UC_KAPILARI) as EntegrasyonKapiliUc[]) if (entegrasyonUcKapisindanGecer(rol, uc) && !entegrasyonUcKapisindanGecer('Admin', uc)) kacak.push(`${rol} ${uc}`);
      for (const y of MIKRO_EVRAK_KAPILARI.keys()) if (evrakKapisindanGecer(rol, y) && !evrakKapisindanGecer('Admin', y)) kacak.push(`${rol} ${y}`);
      for (const k of KURALLI_KOLEKSIYONLAR) for (const op of ['read', 'write', 'delete'] as DbOp[]) if (isAllowed(rol, k, op) && !isAllowed('Admin', k, op)) kacak.push(`${rol} ${k}:${op}`);
    }
    expect(kacak).toEqual([]);
    expect(Object.keys(MIKRO_UC_KAPILARI).length).toBeGreaterThan(0);
    expect(Object.keys(ENTEGRASYON_UC_KAPILARI).length).toBeGreaterThan(0);
  });
});

// ═══ Çit — bağ ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('çit — simülatör ayarlayıcısı bağlı; App\'te `setUserRole` niteliğini alan TEK sayfa Yönetim sayfası', () => {
  it('App.tsx: `setUserRole=` tek yerde ve simülatör ayarlayıcısına bağlı', () => {
    const app = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod.trim());
    expect(app.filter(s => /\bsetUserRole=\{/.test(s))).toEqual(['setUserRole={simulatorRolunuAyarla}']);
  });
});

// ═══ Çıkış penceresi — yayin17 birleşme düzeltmesinin delta incelemesi ═══════════════════════════════════════════════════════
describe('çıkış sürerken yeniden deneme zamanlayıcısı tur ATMAZ', () => {
  // `handleLogout` sunucu çıkışını beklerken simülatör bayrağı geçersiz kılınır ve `kuyrukRolu` simüle role döner; zamanlayıcı efekti
  // yeniden kurulup açılış turunu atıyordu (çıkan oturum adına bir `syncJobs` okuması daha). Zamanlayıcı turu çıkış bayrağına bakar.
  it.each([false, true])('simülasyon %s: çıkış isteği askıdayken `GET /api/db/syncJobs` sayısı değişmez', async (simule) => {
    const sonuc = await yoneticiOlarakAc();
    if (simule) { await simuleEt(sonuc, 'Purchasing'); expect(depoRolu()).toBe('Purchasing'); }
    let coz: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn((g: RequestInfo | URL, i?: RequestInit) => {
      const ham = typeof g === 'string' ? g : g instanceof URL ? g.href : g.url;
      if (ham.split('?')[0] === '/api/db/session/logout') {
        istekler.push({ yontem: 'POST', yol: '/api/db/session/logout', govde: null });
        return new Promise<Response>(r => { coz = r; });
      }
      return sahteFetch(g, i);
    }));
    const okumalar = () => istekler.filter(x => x.yol === '/api/db/syncJobs' && x.yontem === 'GET').length;
    const cikis = [...sonuc.container.querySelectorAll('button')].find(b => b.innerHTML.includes('log-out'));
    expect(cikis).toBeDefined();
    if (!cikis) return;
    const once = okumalar();
    await act(async () => { fireEvent.click(cikis); await Promise.resolve(); });
    expect(istekler.some(x => x.yol === '/api/db/session/logout')).toBe(true);
    // Araya App durumunu değiştiren bir tıklama girer (efektler yeniden değerlendirilir), sonra olağan tur süresi kadar beklenir.
    const baska = [...sonuc.container.querySelectorAll('button')]
      .find(b => !b.innerHTML.includes('log-out') && !(b.textContent ?? '').startsWith('Simüle') && (b.textContent ?? '').trim().length > 0);
    if (baska) await act(async () => { fireEvent.click(baska); });
    await act(async () => { await vi.advanceTimersByTimeAsync(91_000); });
    expect(okumalar()).toBe(once);
    coz(yanit({ ok: true }));
    await bekle();
  });
});
