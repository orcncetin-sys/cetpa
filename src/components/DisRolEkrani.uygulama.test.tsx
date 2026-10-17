// @vitest-environment jsdom
/**
 * DisRolEkrani.uygulama.test.tsx — dış rol (B2B / Bayi) istemci kapısı, UYGULAMA düzeyinde (şartname
 * `.wf/SARTNAME-dis-rol-kapanisi.md` D5, T4, T6). GERÇEK `App.tsx` çizilir; saf koşullar ve sayfanın kendisi
 * `DisRolEkrani.test.tsx`te.
 *
 * NEDEN GERÇEK APP: kapı tek bir satır değil — kabuğun çizimi + on beşe yakın veri efekti + sekme kapılı kanca.
 * Kaynak çiti «koşul yazılmış mı»yı görür, «yeni eklenen efekt kapıdan geçiyor mu»yu görmez. Burada ölçülen DAVRANIŞTIR:
 * dış rol oturumunda giden her istek, açılan her dinleyici, kurulan her zamanlayıcı sayılır; her üst sekme adresi denenir.
 * Yeni bir veri efekti kapısız yazılırsa bu dosya kırmızıya döner (liste elle güncellenmez).
 *
 * Sahte olanlar YALNIZ dış dünya: Firebase kimliği (`firebase/auth`, `../firebase`), `fetch`, `EventSource`, zaman.
 * `lib/dbClient` GERÇEKTİR (yalnız `onSnapshot` sayılarak aynen çağrılır): istek yolları ve akış bağlantısı üretimdekiyle
 * aynı koddan çıkar. Tembel sayfalar (`React.lazy`) boş çizilir: ölçülen App'in kendi efektleridir, sayfa paketlerinin
 * yüklenme zamanlaması değil (yoksa sonuç makinenin o anki yüküne bağlı olurdu).
 *
 * Kaynağa bakan birkaç çit de var: davranışla GÖRÜLEMEYEN yerler (dış rolde kabuk çizilmediği için `canAccess` ve izin
 * tablosu ekrana yansımaz) ve «yazıldı ama bağlanmadı» bağı.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type React from 'react';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';
import { EXTERNAL_ROLES, STAFF_ROLES } from '../lib/rbac';
import { TOP_LEVEL_TABS } from '../lib/topLevelTabs';
import { MAGAZA_PANEL_BAGLAN_YOLU } from '../lib/magazaPanelBaglan';
import { CIKIS_UCU } from '../lib/oturumCikisi';
import { UserRole } from '../types';

const UID = 'uid-deneme-1';
// Gerçek App çizilir; yük altında (bütün takım koşarken) tek açılış saniyeyi bulabilir.
vi.setConfig({ testTimeout: 60_000 });

interface IkiAdim { enabled: boolean; verified: boolean }
const durum = vi.hoisted(() => ({
  /** `users/<uid>` belgesindeki rol; `undefined` = rol alanı yok (rolsüz hesap). */
  rol: 'Sales' as string | undefined,
  ikiAdim: { enabled: false, verified: false } as IkiAdim,
  /** Kendi `users` belgesinin okuması 403 dönsün mü (iki adımlı doğrulama bekleyen oturum). */
  belgeKapali: false,
  kullanici: {
    uid: 'uid-deneme-1', email: 'deneme@ornek.test', displayName: 'Deneme Kullanıcı', photoURL: '', isAnonymous: false,
    emailVerified: true, tenantId: null, providerData: [], getIdToken: async () => 'belirtec-deneme',
  },
  /** Tarayıcıda saklı oturumun sahibi (çıkıştan sonra `null`). */
  hesap: null as { uid: string } | null,
  /** Firebase gibi: saklı oturum YÜKLENENE kadar `currentUser` `null`dır; dinleyiciler yükleme bitince ateşlenir. */
  yuklendi: false,
  /** App'in oturum dinleyicisi — aynı sekmede ikinci girişi canlandırmak için saklanır. */
  oturumDinleyicisi: null as ((u: unknown) => void | Promise<void>) | null,
  cikisSayisi: 0,
  /** `onSnapshot` ile abone olunan koleksiyonlar (çağrı sırasıyla). */
  dinleyiciler: [] as string[],
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ get currentUser() { return durum.yuklendi ? durum.hesap : null; } }),
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void | Promise<void>) => {
    durum.oturumDinleyicisi = cb;
    queueMicrotask(() => { durum.yuklendi = true; void cb(durum.hesap); });
    return () => {};
  },
  signOut: async () => { durum.cikisSayisi += 1; durum.hesap = null; },
  getRedirectResult: async () => null,
  GoogleAuthProvider: class {},
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(), sendPasswordResetEmail: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: {
    get currentUser() { return durum.yuklendi ? durum.hesap : null; },
    // `dbClient` belirteç isterken oturum henüz yüklenmemişse bunu bekler (gerçek Firebase yükleme bitince çağırır).
    onAuthStateChanged: (cb: (u: unknown) => void) => { queueMicrotask(() => { durum.yuklendi = true; cb(durum.hesap); }); return () => {}; },
  },
}));
vi.mock('../lib/dbClient', async (asilAl) => {
  const asil = await asilAl<typeof import('../lib/dbClient')>();
  const say = (hedef: { coll?: string; path?: string }, ...kalan: unknown[]) => {
    durum.dinleyiciler.push(hedef.coll ?? hedef.path ?? '?');
    return (asil.onSnapshot as (...a: unknown[]) => () => void)(hedef, ...kalan);
  };
  return { ...asil, onSnapshot: say };
});
vi.mock('react', async (asilAl) => {
  // App `React.lazy(…)` yazar (varsayılan dışa aktarım); adlı `lazy` de aynı vekile bağlanır.
  const asil = await asilAl<typeof import('react') & { default: typeof import('react') }>();
  const lazy = () => () => null;
  return { ...asil, lazy, default: { ...asil.default, lazy } };
});

interface Istek { yontem: string; yol: string }
let istekler: Istek[] = [];
let akislar: string[] = [];
let araliklar: number[] = [];

const yanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });

/** Sunucunun yerine geçen en küçük yanıtlayıcı. Yöntem, IIS tünelindeki asıl yöntemdir (`X-Cetpa-Method`). */
function sahteFetch(girdi: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ham = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
  const basliklar = (init?.headers ?? {}) as Record<string, string>;
  const yontem = (basliklar['X-Cetpa-Method'] ?? init?.method ?? 'GET').toUpperCase();
  const yol = ham.split('?')[0];
  istekler.push({ yontem, yol });
  if (yol === '/api/mfa/status') return Promise.resolve(yanit(durum.ikiAdim));
  if (yol === `/api/db/users/${UID}` && yontem === 'GET') {
    if (durum.belgeKapali) return Promise.resolve(yanit({ error: 'İki adımlı doğrulama gerekli' }, 403));
    return Promise.resolve(yanit({ data: { ...(durum.rol === undefined ? {} : { role: durum.rol }), companyId: 'sirket-1', name: 'Deneme Kullanıcı' } }));
  }
  if (yol === '/api/superadmin/me') return Promise.resolve(yanit({ isSuperAdmin: false }));
  if (yol === '/api/settings/exchange-rates') return Promise.resolve(yanit({ rates: { USD: 40, EUR: 45 } }));
  if (yol.startsWith('/api/db/') && yontem === 'GET' && yol.split('/').length === 4) return Promise.resolve(yanit({ docs: [] }));
  return Promise.resolve(yanit({}));
}

class SahteAkis {
  static CLOSED = 2;
  readyState = 0;
  onerror: (() => void) | null = null;
  constructor(url: string) { akislar.push(url); }
  addEventListener(): void {}
  close(): void { this.readyState = 2; }
}

// App'in içe aktarılması (bütün ekran ağacı) testlerin süresinden SAYILMAZ: yük altında saniyeler sürebilir.
let App: React.ComponentType;
let tazele: () => void;
/** Oturum deposu (`beforeAll`da yüklenir): çıkıştan sonra depodaki rol açılış varsayılanına dönmüş olmalı. */
let appDeposu: typeof import('../store/appStore').useAppStore;
beforeAll(async () => {
  App = (await import('../App')).default;
  const { resetStream } = await import('../lib/dbClient');
  const { resetLazyCollections } = await import('../lib/lazyCollections');
  const { useAppStore } = await import('../store/appStore');
  appDeposu = useAppStore;
  // Her açılış TAZE sayfadır: modül düzeyi durum (akış, yapışkan koleksiyon kapıları, oturum deposu) önceki açılıştan
  // sızmasın. Depo sıfırlanmazsa önceki oturumun kiracı kimliği daha oturum çözülmeden bir dinleyici açtırır — gerçekte
  // sayfa yüklenirken depo boştur (kalıcı değil), çıkışta da boşaltılır.
  tazele = () => { resetStream(); resetLazyCollections(); useAppStore.setState(useAppStore.getInitialState()); };
}, 180_000);

beforeEach(() => {
  istekler = []; akislar = []; araliklar = [];
  durum.rol = 'Sales'; durum.ikiAdim = { enabled: false, verified: false }; durum.belgeKapali = false;
  durum.hesap = durum.kullanici; durum.yuklendi = false; durum.oturumDinleyicisi = null; durum.cikisSayisi = 0; durum.dinleyiciler = [];
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T09:00:00+03:00'));
  vi.stubGlobal('fetch', vi.fn(sahteFetch));
  vi.stubGlobal('EventSource', SahteAkis);
  const asilAralik = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number, ...kalan: unknown[]) => {
    araliklar.push(Number(ms));
    return asilAralik(fn, ms, ...kalan);
  }) as typeof setInterval);
  // App açılışta beklenen hataları konsola yazar (ör. doğrulama bekleyen oturumda kendi belgesi 403); çıktı sessiz kalsın.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Akış bağlantısı abonelikten 400 ms sonra açılır; 2 sn her açılış efektini ve o gecikmeyi kapsar. */
const bekle = () => act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

/** Uygulamayı verilen rol ve adresle açar; açılış efektleri ve akış gecikmesi tamamlanınca döner. */
async function ac(rol: string | undefined, yol: string) {
  durum.rol = rol;
  durum.hesap = durum.kullanici; durum.yuklendi = false;
  istekler = []; akislar = []; araliklar = []; durum.dinleyiciler = [];
  window.history.pushState({}, '', yol);
  tazele();
  const sonuc = render(<BrowserRouter><App /></BrowserRouter>);
  await bekle();
  return sonuc;
}
/** Açılışı kapatır ve askıdaki zamanlayıcıları boşaltır (sonraki açılışa iş kalmasın). */
async function kapat() {
  cleanup();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
}

const BASLIK = 'Bu hesap bayi hesabıdır';
const METIN = 'ERP ekranı bayi hesaplarına kapalıdır. Sipariş ve bilgi için CETPA ile iletişime geçin.';
const kabukVar = (kap: HTMLElement) => kap.querySelector('nav') !== null || kap.querySelector('aside') !== null;
const bayiBasligi = (kap: HTMLElement) => [...kap.querySelectorAll('h1')].find(h => h.textContent === BASLIK) ?? null;

/**
 * Dış rol (ve rolsüz hesap) oturumunda GİDEBİLEN istekler = şartname D4′ izin listesinin istemcinin açılışta kullandığı
 * kısmı + kimlik istemeyen herkese açık uçlar. Bunun dışındaki her istek kapıdan kaçmış bir efekttir (sunucu 403 verirdi).
 * Liste bilerek DAR: akış çerezi (`POST /api/db/session`) sunucuda serbesttir ama yalnız akış açılırken atılır — burada
 * görülmesi akışın başladığını gösterir, o yüzden izinli sayılmaz.
 */
const IZINLI: readonly string[] = [
  'GET /api/mfa/status',
  `GET /api/db/users/${UID}`, `PUT /api/db/users/${UID}`, `PATCH /api/db/users/${UID}`,   // oturum açılışı: kendi belgesi
  'GET /api/superadmin/me',
  'GET /api/settings/exchange-rates',   // kimlik istemez (giriş sayfasında da çağrılır)
  'POST /api/hit',                      // kimlik istemez (sayfa sayacı)
];
const izinDisi = () => [...new Set(istekler.map(i => `${i.yontem} ${i.yol}`))].filter(i => !IZINLI.includes(i)).sort();
const akisKoleksiyonlari = () => akislar.flatMap(u => decodeURIComponent(u.split('colls=')[1]?.split('&')[0] ?? '').split(','));

const YOLLAR = ['/', ...[...TOP_LEVEL_TABS].map(s => `/${s}`), MAGAZA_PANEL_BAGLAN_YOLU];

describe('düzenek canlı: iç rolde aynı ölçüm DOLU gelir (boş ölçüm «dış rol temiz» diye okunmasın)', () => {
  it('Satış rolü / pano: kabuk çizilir; dinleyiciler, akış bağlantısı, rapor özeti ve Mikro zamanlayıcısı başlar', async () => {
    const { container } = await ac('Sales', '/dashboard');
    expect(kabukVar(container)).toBe(true);
    expect(bayiBasligi(container)).toBeNull();
    // Ana veri efekti + sekme kapılı kanca (pano → vergi takvimi): veri sekmesi iç rolde sekmeyi AYNEN geçirir.
    for (const k of ['orders', 'inventory', 'leads', 'quotations', 'notifications', 'subscriptions', 'supplierRatings', 'reportTargets', 'vergiTakvimi']) {
      expect(durum.dinleyiciler, k).toContain(k);
    }
    expect(akislar.length).toBeGreaterThanOrEqual(1);
    expect(akisKoleksiyonlari()).toEqual(expect.arrayContaining(['orders', 'inventory', 'vergiTakvimi']));
    const giden = istekler.map(i => `${i.yontem} ${i.yol}`);
    expect(giden).toContain('GET /api/reports/summary');
    expect(giden).toContain('POST /api/db/session');
    expect(giden).toContain('GET /api/db/syncJobs');            // Mikro yeniden deneme: açılışta bir tur
    expect(giden).toContain(`GET /api/db/aiConsents/${UID}`);
    expect(araliklar).toContain(90_000);                         // …ve 90 sn'de bir
  });

  it('Satış rolü / stok: sayım oturumu sorgusu ve sekme kapılı stok dinleyicileri oturum çözülünce başlar', async () => {
    await ac('Sales', '/inventory');
    expect(istekler.map(i => `${i.yontem} ${i.yol}`)).toContain('GET /api/db/stockCountSessions');
    expect(durum.dinleyiciler).toContain('warranties');          // tembel koleksiyon kapısı (inventory)
    expect(durum.dinleyiciler).toContain('stockBatches');        // useSekmeVerileri (inventory)
  });

  it('Yönetici / yönetim: denetim kaydı dinleyicisi başlar', async () => {
    await ac('Admin', '/admin');
    expect(durum.dinleyiciler).toContain('auditLog');
  });

  it('klavye kısayolu düzenekte çalışıyor: Satış rolü «c» ile CRM\'e geçer, komisyon kuralları dinlenir', async () => {
    await ac('Sales', '/dashboard');
    expect(durum.dinleyiciler).not.toContain('commissionRules');
    fireEvent.keyDown(document.body, { key: 'c' });
    await bekle();
    expect(durum.dinleyiciler).toContain('commissionRules');
  });

  it('her İÇ rol kabuğu görür; hiçbiri bayi sayfasına düşmez', async () => {
    expect(STAFF_ROLES.length).toBeGreaterThan(0);
    for (const rol of STAFF_ROLES) {
      const { container } = await ac(rol, '/dashboard');
      expect(kabukVar(container), rol).toBe(true);
      expect(bayiBasligi(container), rol).toBeNull();
      expect(durum.dinleyiciler, rol).toContain('orders');
      await kapat();
    }
  }, 60_000);
});

describe.each(EXTERNAL_ROLES.map(r => [r]))('dış rol %s: ERP kabuğu çizilmez, veri istenmez (D5)', (rol) => {
  it('küme boş değil ve her üst sekme adresi deneniyor', () => {
    expect(EXTERNAL_ROLES.length).toBeGreaterThan(0);
    expect(YOLLAR.length).toBe(TOP_LEVEL_TABS.size + 2);   // kök + her üst sekme + mağaza paneli onay adresi
    expect(TOP_LEVEL_TABS.size).toBeGreaterThan(20);
    expect(YOLLAR).toEqual(expect.arrayContaining(['/', '/dashboard', '/b2b', '/inventory', '/crm', '/admin', '/muhasebe']));
  });

  it('her adreste: tek sayfa çizilir; izin dışı istek 0, dinleyici 0, akış bağlantısı 0, 90 sn zamanlayıcısı yok', async () => {
    const ihlal: string[] = [];
    for (const yol of YOLLAR) {
      const { container } = await ac(rol, yol);
      const h1 = [...container.querySelectorAll('h1')];
      if (kabukVar(container)) ihlal.push(`${yol}: ERP kabuğu çizildi`);
      if (container.querySelectorAll('main').length !== 1 || h1.length !== 1 || h1[0].textContent !== BASLIK) ihlal.push(`${yol}: tek sayfa / tek başlık yok`);
      if (!container.textContent?.includes(METIN)) ihlal.push(`${yol}: açıklama metni yok`);
      if (izinDisi().length) ihlal.push(`${yol}: izin dışı istek → ${izinDisi().join(', ')}`);
      if (istekler.some(i => i.yol.startsWith('/api/db/') && i.yol !== `/api/db/users/${UID}`)) ihlal.push(`${yol}: kendi belgesi dışında /api/db/ isteği`);
      if (durum.dinleyiciler.length) ihlal.push(`${yol}: dinleyici → ${[...new Set(durum.dinleyiciler)].sort().join(', ')}`);
      if (akislar.length) ihlal.push(`${yol}: akış bağlantısı → ${akisKoleksiyonlari().join(', ')}`);
      if (araliklar.includes(90_000)) ihlal.push(`${yol}: Mikro yeniden deneme zamanlayıcısı kuruldu`);
      await kapat();
    }
    expect(ihlal).toEqual([]);
  }, 120_000);

  it('açılış kırılmaz: kendi `users` belgesi okunur ve giriş bilgisi yazılır (izin listesindeki yol)', async () => {
    await ac(rol, '/');
    const giden = istekler.map(i => `${i.yontem} ${i.yol}`);
    expect(giden).toContain('GET /api/mfa/status');
    expect(giden).toContain(`GET /api/db/users/${UID}`);
    expect(giden).toContain(`PATCH /api/db/users/${UID}`);
  });

  it('«Çıkış»: mevcut çıkış işleyicisi çalışır (sunucu çıkışı + oturum kapatma), sayfa kalkar', async () => {
    const { container, getByRole } = await ac(rol, '/dashboard');
    expect(bayiBasligi(container)).not.toBeNull();
    istekler = [];
    fireEvent.click(getByRole('button', { name: 'Çıkış' }));
    await bekle();
    expect(istekler.filter(i => i.yol === CIKIS_UCU).map(i => i.yontem)).toEqual(['POST']);
    expect(durum.cikisSayisi).toBe(1);
    expect(bayiBasligi(container)).toBeNull();
    expect(kabukVar(container)).toBe(false);   // çıkıştan sonra kabuk DEĞİL, oturumsuz sayfa
  });

  it('klavye kısayolları (sekme değiştiren harfler, arama, yeni kayıt) sayfadayken veri efekti tetiklemez', async () => {
    const { container } = await ac(rol, '/dashboard');
    istekler = []; akislar = []; durum.dinleyiciler = [];
    for (const tus of ['c', 'i', 'o', 'r', 'd', 'n', '?']) {
      fireEvent.keyDown(document.body, { key: tus });
      await bekle();
    }
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    await bekle();
    expect(bayiBasligi(container)).not.toBeNull();
    expect(kabukVar(container)).toBe(false);
    expect(izinDisi()).toEqual([]);
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
  });

  it('çıkıştan sonra AYNI sekmede iç rolle giriş: önceki oturumun dış rolü yapışmaz — kabuk çizilir, veri başlar', async () => {
    const { container, getByRole } = await ac(rol, '/dashboard');
    fireEvent.click(getByRole('button', { name: 'Çıkış' }));
    await bekle();
    durum.rol = 'Sales';
    durum.hesap = durum.kullanici;
    durum.dinleyiciler = []; istekler = [];
    await act(async () => { await durum.oturumDinleyicisi?.(durum.kullanici); });
    await bekle();
    expect(bayiBasligi(container)).toBeNull();
    expect(kabukVar(container)).toBe(true);
    expect(durum.dinleyiciler).toEqual(expect.arrayContaining(['orders', 'inventory', 'leads']));
    expect(istekler.map(i => `${i.yontem} ${i.yol}`)).toContain('GET /api/reports/summary');
  });
});

describe('kapının sınırları: rolsüz hesap ve rolü okunamayan oturum bugünkü gibi (bu turda değişmedi)', () => {
  it('rolsüz hesap bayi sayfasına DÜŞMEZ: «rol atanmamış» uyarısı çizilir', async () => {
    const { container } = await ac(undefined, '/dashboard');
    expect(bayiBasligi(container)).toBeNull();
    expect(container.textContent).toContain('Hesabınıza rol atanmamış');
  });

  it('bayi oturumundan sonra AYNI sekmede doğrulaması bekleyen giriş: bayi sayfası doğrulama penceresinin yerine geçmez', async () => {
    const { container } = await ac(EXTERNAL_ROLES[0], '/dashboard');
    expect(bayiBasligi(container)).not.toBeNull();
    // İkinci giriş: iki adımlı doğrulama açık + doğrulanmamış → kendi belgesi 403, rol OKUNAMAZ (eldeki rol öncekinden kalma).
    durum.ikiAdim = { enabled: true, verified: false };
    durum.belgeKapali = true;
    durum.dinleyiciler = []; akislar = [];
    expect(durum.oturumDinleyicisi).not.toBeNull();
    await act(async () => { await durum.oturumDinleyicisi?.(durum.kullanici); });
    await bekle();
    expect(bayiBasligi(container)).toBeNull();
    expect(container.textContent).toContain('İki Faktörlü Doğrulama');
    // Rol hâlâ bilinmiyor / dış rol görünüyor: veri yine İSTENMEZ.
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
  });
});

// ── Çıkışta rol sıfırlanır (inceleme bulgusu, 2026-10-17) ───────────────────────────────────────────────────────────────
// Eskiden çıkış rolü SIFIRLAMIYORDU: aynı sekmede rolü YAZILMAYAN sonraki giriş (rolsüz hesap; kendi belgesi okunamayan iç rol)
// önceki oturumun dış rolünü devralıyor, «rol atanmamış» ekranı / kabuk yerine bayi sayfası çiziliyordu. İki çıkış yolu ayrı
// sınanır, çünkü sahte `signOut` dinleyiciyi `null` ile ÇAĞIRMAZ: «Çıkış» düğmesi yalnız `handleLogout`u, `null` ile çağrılan
// dinleyici yalnız dinleyici dalını (başka sekmeden çıkış, belirteç iptali) ölçer — biri sökülürse kendi satırı kırmızıya döner.
describe.each(EXTERNAL_ROLES.map(r => [r]))('dış rol %s → çıkış → aynı sekmede rolü yazılmayan giriş: önceki rol devralınmaz', (rol) => {
  type CikisYolu = 'Çıkış düğmesi' | 'oturum dinleyicisi (null)';
  const YOLLAR_CIKIS: CikisYolu[] = ['Çıkış düğmesi', 'oturum dinleyicisi (null)'];

  /** Dış rolle açar ve verilen yoldan çıkar; çıkıştan sonra bayi sayfası kalkmış olmalı. */
  async function acVeCik(yol: CikisYolu) {
    const sonuc = await ac(rol, '/dashboard');
    expect(bayiBasligi(sonuc.container)).not.toBeNull();
    if (yol === 'Çıkış düğmesi') {
      fireEvent.click(sonuc.getByRole('button', { name: 'Çıkış' }));
      await bekle();
      expect(durum.cikisSayisi).toBe(1);
    } else {
      // Başka sekmeden çıkış / belirteç iptali: `handleLogout` ÇALIŞMAZ, yalnız dinleyici `null` görür.
      durum.hesap = null;
      expect(durum.oturumDinleyicisi).not.toBeNull();
      await act(async () => { await durum.oturumDinleyicisi?.(null); });
      await bekle();
      expect(durum.cikisSayisi).toBe(0);
    }
    expect(bayiBasligi(sonuc.container)).toBeNull();
    // Depodaki rol de açılış varsayılanına döndü (`storeSetRole(UserRole.Sales)` — iki çıkış yolunda da).
    expect(appDeposu.getState().userRole).toBe(UserRole.Sales);
    return sonuc;
  }
  /** Aynı sekmede yeniden giriş (dinleyici yeni oturumla ateşlenir). */
  async function yenidenGir() {
    durum.hesap = durum.kullanici;
    durum.dinleyiciler = []; istekler = []; akislar = [];
    await act(async () => { await durum.oturumDinleyicisi?.(durum.kullanici); });
    await bekle();
  }

  it.each(YOLLAR_CIKIS.map(y => [y]))('%s → rolsüz hesapla giriş: bayi sayfası YOK, «rol atanmamış» uyarısı VAR', async (yol) => {
    const { container } = await acVeCik(yol);
    durum.rol = undefined;
    await yenidenGir();
    expect(bayiBasligi(container)).toBeNull();
    expect(container.textContent).toContain('Hesabınıza rol atanmamış');
  });

  it.each(YOLLAR_CIKIS.map(y => [y]))('%s → iç rol, kendi belgesi okunamıyor: bayi sayfası YOK (taze sekmeyle aynı başlangıç)', async (yol) => {
    const { container } = await acVeCik(yol);
    durum.rol = 'Sales';
    durum.belgeKapali = true;
    durum.ikiAdim = { enabled: false, verified: false };
    await yenidenGir();
    expect(istekler.map(i => `${i.yontem} ${i.yol}`)).toContain(`GET /api/db/users/${UID}`);   // belge gerçekten istendi (403)
    expect(bayiBasligi(container)).toBeNull();
    // Rol okunamadı: açılış varsayılanı (`Sales`) kalır, taze sekmedeki gibi kabuk çizilir. Bu «okunamayınca Sales» davranışı
    // ayrı düzeltmedir (kullanıcı onayı bekliyor); o gelince bu satır da değişir.
    expect(kabukVar(container)).toBe(true);
  });

  // Rolsüz oturumdan «Çıkış Yap» düğmesiyle çıkış katmandaki `onClick={handleLogout}` üzerinden yapılır: ikinci çıkış da sınanan
  // yoldan geçer. `setRoleMissing(false)` sıfırlaması sökülürse «rol atanmamış» katmanı sonraki iç rol oturumunda kalır.
  it.each(YOLLAR_CIKIS.map(y => [y]))('%s → rolsüz hesap → aynı yoldan çıkış → iç rol, belgesi okunamıyor: «rol atanmamış» katmanı YOK', async (yol) => {
    const sonuc = await acVeCik(yol);
    durum.rol = undefined;
    await yenidenGir();
    expect(sonuc.container.textContent).toContain('Hesabınıza rol atanmamış');
    if (yol === 'Çıkış düğmesi') {
      fireEvent.click(sonuc.getByRole('button', { name: 'Çıkış Yap' }));
      await bekle();
    } else {
      durum.hesap = null;
      await act(async () => { await durum.oturumDinleyicisi?.(null); });
      await bekle();
    }
    durum.rol = 'Sales';
    durum.belgeKapali = true;
    durum.ikiAdim = { enabled: false, verified: false };
    await yenidenGir();
    expect(istekler.map(i => `${i.yontem} ${i.yol}`)).toContain(`GET /api/db/users/${UID}`);
    expect(sonuc.container.textContent).not.toContain('Hesabınıza rol atanmamış');
    expect(kabukVar(sonuc.container)).toBe(true);
  });
});

// ── Kaynak çitleri: davranışla görülemeyen yerler + «yazıldı ama bağlanmadı» bağı ───────────────────────────────
describe('App.tsx kaynağı — dış rol kapısı bağlı', () => {
  const satirlar = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod);
  const kod = satirlar.join('\n');
  const say = (desen: RegExp) => satirlar.filter(s => desen.test(s)).length;
  const sira = (parca: string) => {
    const i = satirlar.findIndex(s => s.includes(parca));
    expect(i, `App.tsx içinde bulunamadı: ${parca}`).toBeGreaterThan(-1);
    return i;
  };

  it('rol TEK yardımcıdan sorulur: `disRol = disRolMu(userRole)` tam 1 kez; App içinde `EXTERNAL_ROLES` yok', () => {
    expect(say(/^\s*const disRol = disRolMu\(userRole\);$/)).toBe(1);
    expect(say(/disRolMu\(/)).toBe(1);
    expect(kod).not.toMatch(/EXTERNAL_ROLES/);
    expect(kod).toMatch(/import DisRolEkrani, \{ disRolMu, disRolEkraniGosterilir, veriSekmesi \} from '\.\/components\/DisRolEkrani';/);
  });

  it('izin tablosunun HİÇBİR satırında dış rol yok (tarama canlı: bilinen satırlar okunuyor)', () => {
    const i = kod.indexOf('const TAB_PERMISSIONS');
    expect(i).toBeGreaterThan(-1);
    const tablo = kod.slice(i, kod.indexOf('\n};', i));
    const roller = [...tablo.matchAll(/UserRole\.(\w+)/g)].map(m => m[1]);
    expect(tablo.split('\n').filter(s => /full:\s*\[/.test(s)).length).toBeGreaterThanOrEqual(25);
    expect(roller).toContain('Admin');
    expect(roller).toContain('Sales');
    for (const dis of EXTERNAL_ROLES) expect(roller, dis).not.toContain(dis);
    // Dış rollerin eskiden yazılı olduğu iki satır duruyor (satır silinip sekme «kayıtsız» dalına düşürülmedi).
    expect(tablo).toMatch(/^\s*dashboard:\s*\{ full: \[/m);
    expect(tablo).toMatch(/^\s*b2b:\s*\{ full: \[/m);
  });

  it('`canAccess` ve `hasFullAccess` dış role tablodan ÖNCE `false` döner (kayıtsız sekme dalı dâhil)', () => {
    for (const ad of ['canAccess', 'hasFullAccess']) {
      const i = sira(`const ${ad} = (tab: string) => {`);
      expect(satirlar[i + 1].trim(), ad).toBe('if (disRol) return false;');
      expect(satirlar[i + 2].trim(), ad).toBe('const perms = TAB_PERMISSIONS[tab];');
    }
  });

  it('çizim kapısı: oturum çözülünce, karşılama / giriş / kabuktan ÖNCE; tek yerde', () => {
    const kapi = sira('if (disRolEkraniGosterilir({ oturumVar: !!user, rol: userRole, ikiAdimBekliyor: mfaChallenge })) {');
    expect(satirlar[kapi + 1].trim()).toBe('return <DisRolEkrani dil={currentLanguage} onCikis={handleLogout} />;');
    expect(say(/disRolEkraniGosterilir\(/)).toBe(1);
    expect(say(/<DisRolEkrani\b/)).toBe(1);
    expect(kapi).toBeGreaterThan(sira('if (!isAuthReady) return ('));
    expect(kapi).toBeLessThan(sira('const uygulamaYolundaMi ='));
    expect(kapi).toBeLessThan(sira('if (!user && !isGuestMode) {'));
    expect(kapi).toBeLessThan(sira('if (baglanSayfasi && user) {'));
  });

  it('sekme kapılı dinleyiciler `activeTab`i DOĞRUDAN almaz: veri sekmesinden geçer', () => {
    expect(say(/^\s*const veriSekme = veriSekmesi\(\{ oturumVar: !!user, rol: userRole, sekme: activeTab \}\);$/)).toBe(1);
    expect(say(/useSekmeVerileri\(\{ user, activeTab: veriSekme, /)).toBe(1);
    expect(say(/useSekmeVerileri\(/)).toBe(1);
    expect(say(/if \(veriSekme !== 'inventory' \|\| p584Active\) return;/)).toBe(1);
  });
});
