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
 *
 * 2026-10-17 GENİŞLETME (şartname «kayıt kapanışı ve kuruş» R / R testleri′): rol okunamazsa «Sales»e düşme YOK. Düzenek yol başına
 * durum kodu DİZİSİ (`durum.yanitlar`: sırayla tüketilir, bitince olağan yanıt), kalıcı ret (`durum.kalici`), yanıtı bekletilen yol
 * (`durum.askiyaAl` → `birak()`), 403 gövdesinde `mfaRequired` (sunucunun `requireMfaVerified`'ı gibi: doğrulaması açık ve
 * doğrulanmamış hesapta), değiştirilebilir kimlik (uid / e-posta) ve `deleteUser` sayacı taşır; zaman 15 sn'den uzun ilerletilir
 * (kendiliğinden yeniden denemeler 1 + 3 + 9 sn). Eski «kendi belgesi okunamıyor → kabuk çizilir» iki testi R1'e göre TERSİNE döndü.
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
/** Sahte yanıt: [durum kodu, gövde]. */
type SahteYanit = [number, unknown];
const durum = vi.hoisted(() => ({
  /** `users/<uid>` belgesindeki rol; `undefined` = rol alanı yok (rolsüz hesap). */
  rol: 'Sales' as string | undefined,
  ikiAdim: { enabled: false, verified: false } as IkiAdim,
  /** Kendi `users` belgesinin okuması 403 dönsün mü. Gövdede `mfaRequired` yalnız doğrulaması AÇIK ve doğrulanmamış hesapta (sunucunun
   *  `requireMfaVerified`'ı gibi); doğrulaması kapalıysa 403'ün nedeni başkadır (R2: yeniden denenir). */
  belgeKapali: false,
  kullanici: {
    uid: 'uid-deneme-1', email: 'deneme@ornek.test', displayName: 'Deneme Kullanıcı', photoURL: '', isAnonymous: false,
    emailVerified: true, tenantId: null, providerData: [], getIdToken: async () => 'belirtec-deneme',
  } as { uid: string; email: string; displayName: string; photoURL: string; isAnonymous: boolean; emailVerified: boolean; tenantId: null; providerData: unknown[]; getIdToken: () => Promise<string> },
  /** Tarayıcıda saklı oturumun sahibi (çıkıştan sonra `null`). */
  hesap: null as { uid: string } | null,
  /** Yol başına durum kodu DİZİSİ (`"<YÖNTEM> <yol>"`): sırayla tüketilir; bitince kalıcı ret ya da olağan yanıt. */
  yanitlar: {} as Record<string, SahteYanit[]>,
  /** Yol başına KALICI yanıt (dizi bittikten sonra her çağrıda). */
  kalici: {} as Record<string, SahteYanit>,
  /** Yanıtı BEKLETİLEN yollar: istek askıda kalır, sınama `birak()` ile yanıtlar. */
  askiyaAl: new Set<string>(),
  askida: {} as Record<string, Array<(r: Response) => void>>,
  /** `deleteUser` ile silinen kimlik hesapları (uid). */
  silinen: [] as string[],
  /** Firebase gibi: saklı oturum YÜKLENENE kadar `currentUser` `null`dır; dinleyiciler yükleme bitince ateşlenir. */
  yuklendi: false,
  /** App'in oturum dinleyicisi — aynı sekmede ikinci girişi canlandırmak için saklanır. */
  oturumDinleyicisi: null as ((u: unknown) => void | Promise<void>) | null,
  cikisSayisi: 0,
  /** `onSnapshot` ile abone olunan koleksiyonlar (çağrı sırasıyla). */
  dinleyiciler: [] as string[],
  /** «Profiliniz yüklenemedi.» sayfasının App'ten aldığı SON özellikler (sayfa GERÇEK çizilir; yalnız özellikler okunur — İ2-a). */
  profilEkrani: null as { onYenidenDene: () => void } | null,
  /** `GET /api/surum` yanıtındaki sürüm («yeni sürüm» şeridi sınamaları). */
  sunucuSurumu: null as string | null,
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ get currentUser() { return durum.yuklendi ? durum.hesap : null; } }),
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void | Promise<void>) => {
    durum.oturumDinleyicisi = cb;
    queueMicrotask(() => { durum.yuklendi = true; void cb(durum.hesap); });
    return () => {};
  },
  signOut: async () => { durum.cikisSayisi += 1; durum.hesap = null; },
  deleteUser: async (u: { uid: string }) => { durum.silinen.push(u.uid); durum.hesap = null; },
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
// «Profiliniz yüklenemedi.» sayfası GERÇEK çizilir; sarmal yalnız App'in verdiği özellikleri saklar. Böylece App'in «Yeniden dene»
// kapısı (`cikisSuruyorRef`, İ2-a) sayfanın kendi pasif düğmesinden BAĞIMSIZ sınanır (düğme pasifken tıklama işleyiciye ulaşmaz).
vi.mock('./ProfilYuklenemediEkrani', async (asilAl) => {
  const asil = await asilAl<typeof import('./ProfilYuklenemediEkrani')>();
  const { createElement } = await import('react');
  type Ozellikler = Parameters<typeof asil.default>[0];
  const Sarmal = (p: Ozellikler) => { durum.profilEkrani = p; return createElement(asil.default, p); };
  return { ...asil, default: Sarmal };
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
/** Oturumdaki hesabın kendi `users` belgesinin yolu (uid değiştirilebilir). */
const kendiYolu = (): string => `/api/db/users/${durum.kullanici.uid}`;

/** Sunucunun yerine geçen en küçük yanıtlayıcı. Yöntem, IIS tünelindeki asıl yöntemdir (`X-Cetpa-Method`). */
function sahteFetch(girdi: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ham = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
  const basliklar = (init?.headers ?? {}) as Record<string, string>;
  const yontem = (basliklar['X-Cetpa-Method'] ?? init?.method ?? 'GET').toUpperCase();
  const yol = ham.split('?')[0];
  istekler.push({ yontem, yol });
  const anahtar = `${yontem} ${yol}`;
  if (durum.askiyaAl.has(anahtar)) {
    return new Promise<Response>(coz => { (durum.askida[anahtar] ??= []).push(coz); });
  }
  const sira = durum.yanitlar[anahtar]?.shift() ?? durum.kalici[anahtar];
  if (sira) return Promise.resolve(yanit(sira[1], sira[0]));
  if (yol === '/api/mfa/status') return Promise.resolve(yanit(durum.ikiAdim));
  if (yol === kendiYolu() && yontem === 'GET') {
    if (durum.belgeKapali) {
      const mfa = durum.ikiAdim.enabled && !durum.ikiAdim.verified;
      return Promise.resolve(yanit({ error: 'İki adımlı doğrulama gerekli', ...(mfa ? { mfaRequired: true } : {}) }, 403));
    }
    return Promise.resolve(yanit({ data: { ...(durum.rol === undefined ? {} : { role: durum.rol }), companyId: 'sirket-1', name: 'Deneme Kullanıcı' } }));
  }
  if (yol === '/api/superadmin/me') return Promise.resolve(yanit({ isSuperAdmin: false }));
  if (yol === '/api/surum') return Promise.resolve(yanit({ surum: durum.sunucuSurumu }));
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
  durum.kullanici = { ...durum.kullanici, uid: UID, email: 'deneme@ornek.test' };
  durum.yanitlar = {}; durum.kalici = {}; durum.askiyaAl = new Set(); durum.askida = {}; durum.silinen = [];
  durum.hesap = durum.kullanici; durum.yuklendi = false; durum.oturumDinleyicisi = null; durum.cikisSayisi = 0; durum.dinleyiciler = [];
  durum.profilEkrani = null;
  durum.sunucuSurumu = null;
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
/** Zamanı verilen kadar ilerletir (kendiliğinden yeniden denemeler 1 + 3 + 9 sn sürer). */
const ilerlet = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

/** Uygulamayı verilen rol ve adresle açar; açılış efektleri ve akış gecikmesi tamamlanınca (ya da `sure` dolunca) döner. */
async function ac(rol: string | undefined, yol: string, sure = 2_000) {
  durum.rol = rol;
  durum.hesap = durum.kullanici; durum.yuklendi = false;
  istekler = []; akislar = []; araliklar = []; durum.dinleyiciler = [];
  window.history.pushState({}, '', yol);
  tazele();
  const sonuc = render(<BrowserRouter><App /></BrowserRouter>);
  await ilerlet(sure);
  return sonuc;
}
/** Bekletilen yolun askıdaki isteklerini verilen yanıtla sonuçlandırır. */
async function birak(anahtar: string, kod: number, govde: unknown) {
  durum.askiyaAl.delete(anahtar);
  const bekleyen = durum.askida[anahtar] ?? [];
  durum.askida[anahtar] = [];
  await act(async () => { for (const coz of bekleyen) coz(yanit(govde, kod)); await vi.advanceTimersByTimeAsync(0); });
}
/** Bekletilen yolun askıdaki EN ESKİ isteğini yanıtlar; yol bekletilmeye devam eder (sonraki istekler askıda kalır). */
async function birakIlk(anahtar: string, kod: number, govde: unknown) {
  const coz = (durum.askida[anahtar] ?? []).shift();
  if (!coz) throw new Error(`askıda istek yok: ${anahtar}`);
  await act(async () => { coz(yanit(govde, kod)); await vi.advanceTimersByTimeAsync(0); });
}
/** Açılışı kapatır ve askıdaki zamanlayıcıları boşaltır (sonraki açılışa iş kalmasın). */
async function kapat() {
  cleanup();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
}

const BASLIK = 'Bu hesap bayi hesabıdır';
const PROFIL_YUKLENEMEDI = 'Profiliniz yüklenemedi.';
const METIN = 'ERP ekranı bayi hesaplarına kapalıdır. Sipariş ve bilgi için CETPA ile iletişime geçin.';
const kabukVar = (kap: HTMLElement) => kap.querySelector('nav') !== null || kap.querySelector('aside') !== null;
const bayiBasligi = (kap: HTMLElement) => [...kap.querySelectorAll('h1')].find(h => h.textContent === BASLIK) ?? null;
/** Kenar menüsünün «Yönetim» grubu — yalnız Yönetici rolünde çizilir (adla seçici; düzenek canlı testi ölçer). */
const yoneticiMenusu = (kap: HTMLElement) => [...kap.querySelectorAll('aside button')].some(b => (b.textContent ?? '').trim() === 'Yönetim');

/**
 * Dış rol (ve rolsüz hesap) oturumunda GİDEBİLEN istekler = şartname D4′ izin listesinin istemcinin açılışta kullandığı
 * kısmı + kimlik istemeyen herkese açık uçlar. Bunun dışındaki her istek kapıdan kaçmış bir efekttir (sunucu 403 verirdi).
 * Liste bilerek DAR: akış çerezi (`POST /api/db/session`) sunucuda serbesttir ama yalnız akış açılırken atılır — burada
 * görülmesi akışın başladığını gösterir, o yüzden izinli sayılmaz.
 */
const izinli = (): readonly string[] => [
  'GET /api/mfa/status',
  `GET ${kendiYolu()}`, `PUT ${kendiYolu()}`, `PATCH ${kendiYolu()}`,   // oturum açılışı: kendi belgesi
  'GET /api/superadmin/me',
  'GET /api/settings/exchange-rates',   // kimlik istemez (giriş sayfasında da çağrılır)
  'POST /api/hit',                      // kimlik istemez (sayfa sayacı)
  'GET /api/surum',                     // kimlik istemez («yeni sürüm» şeridi; 5 dk'da bir — 2 sn'lik açılış ölçümünde görünmez)
];
const izinDisi = () => { const izin = izinli(); return [...new Set(istekler.map(i => `${i.yontem} ${i.yol}`))].filter(i => !izin.includes(i)).sort(); };
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

describe('kapının sınırları: rolsüz hesap «rol atanmamış» ekranında, doğrulaması bekleyen oturum doğrulama penceresinde', () => {
  it('rolsüz hesap bayi sayfasına DÜŞMEZ: «rol atanmamış» uyarısı çizilir', async () => {
    const { container } = await ac(undefined, '/dashboard');
    expect(bayiBasligi(container)).toBeNull();
    expect(container.textContent).toContain('Hesabınıza rol atanmamış');
  });

  it('bayi oturumundan sonra AYNI sekmede doğrulaması bekleyen giriş: bayi sayfası doğrulama penceresinin yerine geçmez', async () => {
    const { container } = await ac(EXTERNAL_ROLES[0], '/dashboard');
    expect(bayiBasligi(container)).not.toBeNull();
    // İkinci giriş: iki adımlı doğrulama açık + doğrulanmamış → kendi belgesi 403 `mfaRequired`, rol OKUNAMAZ (eldeki rol öncekinden
    // kalma; turun başında açılış varsayılanına döner).
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
    // BİLEREK TERSİNE DÖNDÜ (2026-10-17, şartname R1 — kullanıcı kararı «ok ekle»): eskiden rol okunamayınca açılış varsayılanı
    // (`Sales`) kalıyor ve kabuk çiziliyordu. Artık rol çözülmeden kabuk ÇİZİLMEZ; denemeler bitince «Profiliniz yüklenemedi.».
    expect(kabukVar(container)).toBe(false);
    await ilerlet(15_000);
    expect(kabukVar(container)).toBe(false);
    expect(container.textContent).toContain(PROFIL_YUKLENEMEDI);
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
    // BİLEREK TERSİNE DÖNDÜ (2026-10-17, şartname R1): rol okunamayan oturumda kabuk çizilmez (eskiden `true` idi).
    expect(kabukVar(sonuc.container)).toBe(false);
    await ilerlet(15_000);
    expect(sonuc.container.textContent).toContain(PROFIL_YUKLENEMEDI);
    expect(sonuc.container.textContent).not.toContain('Hesabınıza rol atanmamış');
  });
});

// ═══ R — rol okunamazsa «Sales»e düşme YOK (şartname «kayıt kapanışı ve kuruş» R1–R6, R1′–R5′; kullanıcı kararı «ok ekle») ═══
// Belirti (kullanıcı, 2026-10-11): «refresh yiyince rolüm değişiyor … ben adminim normalde». Kendi belgesi okunamayınca, son giriş
// yazımı düşünce ya da sahip kurulumu reddedilince rol hiç atanmıyor, arayüz Satış rolüyle çiziliyordu. Burada ölçülen: rol çözülmeden
// kabuk ÇİZİLMEZ ve veri BAŞLAMAZ; okunamayan profil üç kendiliğinden denemeden sonra açıkça söylenir; «Yeniden dene» aynı çözümü koşar.
const GET_KENDI = () => `GET ${kendiYolu()}`;
const kendiOkumaSayisi = () => istekler.filter(i => i.yontem === 'GET' && i.yol === kendiYolu()).length;
const kendiYazimlari = (yontem: string) => istekler.filter(i => i.yontem === yontem && i.yol === kendiYolu()).length;
const metin = (kap: HTMLElement) => kap.textContent ?? '';
const SUNUCU_HATASI: SahteYanit = [500, { error: 'Sunucu hatası (sınama)' }];
const MFA_403: SahteYanit = [403, { error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true }];
const SAHIP = 'orcncetin@gmail.com';

describe('R — düzenek canlı: adla seçilen «Yönetim» menüsü yalnız Yönetici rolünde var', () => {
  it('Yönetici → var; Satış → yok (boş ölçüm «menü yok» diye okunmasın)', async () => {
    const yonetici = await ac('Admin', '/dashboard');
    expect(yoneticiMenusu(yonetici.container)).toBe(true);
    await kapat();
    const satis = await ac('Sales', '/dashboard');
    expect(kabukVar(satis.container)).toBe(true);
    expect(yoneticiMenusu(satis.container)).toBe(false);
  });
});

describe('R1 / R2 — profil okuması 500: kabuk yok, üç deneme sonra «Profiliniz yüklenemedi.», «Yeniden dene» aynı çözümü koşar', () => {
  it('500 × 4 sonra 200: menü çizilmez; denemeler bitince ileti; kendiliğinden deneme 4\'te durur; «Yeniden dene» başarıda Yönetici menüsü', async () => {
    durum.yanitlar[GET_KENDI()] = [SUNUCU_HATASI, SUNUCU_HATASI, SUNUCU_HATASI, SUNUCU_HATASI];
    const { container, getByRole } = await ac('Admin', '/dashboard');
    expect(kabukVar(container)).toBe(false);
    expect(metin(container)).not.toContain(PROFIL_YUKLENEMEDI);           // denemeler sürüyor: yükleniyor görünümü
    expect(kendiOkumaSayisi()).toBeLessThan(4);
    await ilerlet(15_000);
    expect(kendiOkumaSayisi()).toBe(4);                                    // ilk okuma + en çok ÜÇ yeniden deneme (1 / 3 / 9 sn)
    expect(kabukVar(container)).toBe(false);
    expect(yoneticiMenusu(container)).toBe(false);
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    expect(getByRole('button', { name: 'Çıkış' })).toBeTruthy();
    await ilerlet(60_000);
    expect(kendiOkumaSayisi()).toBe(4);                                    // kendiliğinden başka deneme YOK
    // R4: her ret günlüğe yalnız DURUM KODUYLA yazılır (e-posta / kimlik yok).
    const gunluk = vi.mocked(console.error).mock.calls.filter(c => c[0] === '[açılış] profil okunamadı');
    expect(gunluk.map(c => c.slice(1))).toEqual([[500], [500], [500], [500]]);
    expect(JSON.stringify(gunluk)).not.toMatch(/deneme@ornek\.test|uid-deneme-1/);
    fireEvent.click(getByRole('button', { name: 'Yeniden dene' }));
    await bekle();
    expect(kendiOkumaSayisi()).toBe(5);
    expect(metin(container)).not.toContain(PROFIL_YUKLENEMEDI);
    expect(kabukVar(container)).toBe(true);
    expect(yoneticiMenusu(container)).toBe(true);
    expect(durum.dinleyiciler).toContain('orders');                        // veri rol çözülünce başladı
  });

  it('«Yeniden dene» çözüm sürerken PASİF: ikinci tıklama ikinci okuma başlatmaz', async () => {
    durum.kalici[GET_KENDI()] = SUNUCU_HATASI;
    const { container, getByRole } = await ac('Admin', '/dashboard');
    await ilerlet(15_000);
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    delete durum.kalici[GET_KENDI()];
    durum.askiyaAl.add(GET_KENDI());
    fireEvent.click(getByRole('button', { name: 'Yeniden dene' }));
    await ilerlet(100);
    const surerken = getByRole('button', { name: 'Deneniyor…' }) as HTMLButtonElement;
    expect(surerken.disabled).toBe(true);
    fireEvent.click(surerken);
    await ilerlet(100);
    expect(kendiOkumaSayisi()).toBe(5);
    await birak(GET_KENDI(), 200, { data: { role: 'Admin', companyId: 'sirket-1', name: 'Deneme Kullanıcı' } });
    await bekle();
    expect(kendiOkumaSayisi()).toBe(5);
    expect(yoneticiMenusu(container)).toBe(true);
  });

  // R1′: «'okunamadi'» durumunda (denemeler bittikten sonra da) veri BAŞLAMAZ — iç rol ve dış rol için ayrı (eski «dış rol + okuma
  // 500 → iç menü yok» maddesinin YERİNE: rol okunamayınca dış rol diğerlerinden ayırt edilemez; ayırt edici olan istek ölçüsüdür).
  it.each(['Admin', 'Sales', ...EXTERNAL_ROLES].map((r): [string] => [r]))('%s, okuma 500: izin dışı istek 0, dinleyici 0, akış bağlantısı 0, 90 sn zamanlayıcısı yok', async (rol) => {
    durum.kalici[GET_KENDI()] = SUNUCU_HATASI;
    const { container } = await ac(rol, '/dashboard');
    await ilerlet(15_000);
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    await ilerlet(100_000);                                                // denemeler bittikten SONRA da
    expect(kabukVar(container)).toBe(false);
    expect(bayiBasligi(container)).toBeNull();
    expect(izinDisi()).toEqual([]);
    expect(istekler.filter(i => i.yol.startsWith('/api/db/') && i.yol !== kendiYolu())).toEqual([]);
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
    expect(araliklar).not.toContain(90_000);
    expect(appDeposu.getState().companyId).toBeNull();                    // kiracı bilinmiyor: tahmin (uid) yazılmaz
  });

  it('R1″ — /admin adresinde Yönetici, okuma 500: adres /admin KALIR; «Yeniden dene» başarıda aktif sekme yönetim (denetim kaydı dinlenir)', async () => {
    durum.yanitlar[GET_KENDI()] = [SUNUCU_HATASI, SUNUCU_HATASI, SUNUCU_HATASI, SUNUCU_HATASI];
    const { container, getByRole } = await ac('Admin', '/admin');
    await ilerlet(15_000);
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    expect(window.location.pathname).toBe('/admin');
    fireEvent.click(getByRole('button', { name: 'Yeniden dene' }));
    await bekle();
    expect(yoneticiMenusu(container)).toBe(true);
    expect(window.location.pathname).toBe('/admin');
    expect(durum.dinleyiciler).toContain('auditLog');                      // yalnız `activeTab === 'admin'` iken dinlenir
  });

  it('«Çıkış»: mevcut çıkış işleyicisi (sunucu çıkışı + oturum kapatma); sayfa kalkar', async () => {
    durum.kalici[GET_KENDI()] = SUNUCU_HATASI;
    const { container, getByRole } = await ac('Sales', '/dashboard');
    await ilerlet(15_000);
    istekler = [];
    fireEvent.click(getByRole('button', { name: 'Çıkış' }));
    await bekle();
    expect(istekler.filter(i => i.yol === CIKIS_UCU).map(i => i.yontem)).toEqual(['POST']);
    expect(durum.cikisSayisi).toBe(1);
    expect(metin(container)).not.toContain(PROFIL_YUKLENEMEDI);
    expect(kabukVar(container)).toBe(false);
  });
});

describe('R2 — 403 `mfaRequired`: doğrulama penceresi; başka ret yeniden denenir', () => {
  it('`/api/mfa/status` 500 (getMfaStatus «kapalı» der) + okuma 403 `mfaRequired` → doğrulama penceresi; yeniden deneme yok, veri yok', async () => {
    durum.kalici['GET /api/mfa/status'] = SUNUCU_HATASI;
    durum.kalici[GET_KENDI()] = MFA_403;
    const { container } = await ac('Admin', '/dashboard');
    expect(metin(container)).toContain('İki Faktörlü Doğrulama');
    expect(kabukVar(container)).toBe(false);
    await ilerlet(20_000);
    expect(kendiOkumaSayisi()).toBe(1);
    expect(metin(container)).toContain('İki Faktörlü Doğrulama');
    expect(metin(container)).not.toContain(PROFIL_YUKLENEMEDI);
    expect(izinDisi()).toEqual([]);
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
    expect(appDeposu.getState().companyId).toBeNull();                    // kiracı bilinmiyor: tahmin (uid) yazılmaz
  });

  it.each([
    ['401', [401, { error: 'Invalid or expired session.' }]],
    ['403 başka neden (mfaRequired yok)', [403, { error: 'Bu firma askıya alınmış.', code: 'COMPANY_SUSPENDED' }]],
    ['429', [429, { error: 'Çok fazla istek.' }]],
    ['503 ROL_OKUNAMADI', [503, { error: 'Rol okunamadı.', code: 'ROL_OKUNAMADI' }]],
  ] as Array<[string, SahteYanit]>)('%s → doğrulama penceresi DEĞİL; üç deneme sonra «Profiliniz yüklenemedi.»', async (_ad, ret) => {
    durum.kalici[GET_KENDI()] = ret;
    const { container } = await ac('Admin', '/dashboard');
    await ilerlet(15_000);
    expect(kendiOkumaSayisi()).toBe(4);
    expect(metin(container)).not.toContain('İki Faktörlü Doğrulama');
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    expect(kabukVar(container)).toBe(false);
  });
});

describe('R3 — rol son giriş yazımına bağlı DEĞİL', () => {
  it('okuma başarılı + son giriş yazımı (PATCH) 500 → rol Yönetici, menü çizilir; ret yalnız günlükte (durum kodu)', async () => {
    durum.kalici[`PATCH ${kendiYolu()}`] = SUNUCU_HATASI;
    const { container } = await ac('Admin', '/dashboard');
    expect(kendiYazimlari('PATCH')).toBe(1);
    expect(kabukVar(container)).toBe(true);
    expect(yoneticiMenusu(container)).toBe(true);
    expect(metin(container)).not.toContain(PROFIL_YUKLENEMEDI);
    const gunluk = vi.mocked(console.error).mock.calls.filter(c => c[0] === '[açılış] son giriş yazılamadı');
    expect(gunluk.map(c => c.slice(1))).toEqual([[500]]);
  });

  it('son giriş yazımı YANIT VERMİYOR (askıda): rol yine ÖNCE atanır, menü çizilir', async () => {
    durum.askiyaAl.add(`PATCH ${kendiYolu()}`);
    const { container } = await ac('Admin', '/dashboard');
    expect(kendiYazimlari('PATCH')).toBe(1);
    expect(yoneticiMenusu(container)).toBe(true);
  });
});

describe('R2′ — «kayıt yok» yalnız durum kodu 404: uid\'si «404» içeren hesap kayıtsız sayılmaz', () => {
  beforeEach(() => { durum.kullanici = { ...durum.kullanici, uid: 'uid-404-deneme' }; });

  it('okuma 500 → üç deneme sonra «Profiliniz yüklenemedi.»; oturum kapatılmaz, hesap silinmez, belge yazılmaz', async () => {
    durum.kalici[GET_KENDI()] = SUNUCU_HATASI;
    const { container } = await ac('Admin', '/dashboard');
    await ilerlet(15_000);
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    expect([durum.cikisSayisi, durum.silinen, kendiYazimlari('PUT'), kendiYazimlari('PATCH')]).toEqual([0, [], 0, 0]);
  });

  it('okuma 403 `mfaRequired` → doğrulama penceresi; oturum kapatılmaz, hesap silinmez, belge yazılmaz', async () => {
    durum.kalici[GET_KENDI()] = MFA_403;
    const { container } = await ac('Admin', '/dashboard');
    await ilerlet(15_000);
    expect(metin(container)).toContain('İki Faktörlü Doğrulama');
    expect([durum.cikisSayisi, durum.silinen, kendiYazimlari('PUT'), kendiYazimlari('PATCH')]).toEqual([0, [], 0, 0]);
  });
});

describe('R2″ — tur numarası: kapanmış oturumun açılış turu hiçbir şey yazmaz', () => {
  it('okuma 500 ve İLK bekleme sürerken dinleyici `null` alır → bekleme bitince oturumsuz sayfa kalır, okuma yeniden çağrılmaz', async () => {
    durum.kalici[GET_KENDI()] = SUNUCU_HATASI;
    const { container } = await ac('Admin', '/dashboard', 300);
    expect(kendiOkumaSayisi()).toBe(1);
    durum.hesap = null;
    await act(async () => { await durum.oturumDinleyicisi?.(null); });
    await ilerlet(20_000);
    expect(kendiOkumaSayisi()).toBe(1);
    expect(metin(container)).not.toContain(PROFIL_YUKLENEMEDI);
    expect(kabukVar(container)).toBe(false);
    expect(durum.dinleyiciler).toEqual([]);
  });

  it('okuma askıdayken dinleyici `null` alır, okuma SONRA 200 döner → kapanmış oturum geri açılmaz (kabuk / menü yok)', async () => {
    durum.askiyaAl.add(GET_KENDI());
    const { container } = await ac('Admin', '/dashboard');
    expect(kendiOkumaSayisi()).toBe(1);
    durum.hesap = null;
    await act(async () => { await durum.oturumDinleyicisi?.(null); });
    await birak(GET_KENDI(), 200, { data: { role: 'Admin', companyId: 'sirket-1', name: 'Deneme Kullanıcı' } });
    await bekle();
    expect(kabukVar(container)).toBe(false);
    expect(yoneticiMenusu(container)).toBe(false);
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
  });

  // EKSİK TESLİM (paket turu, 2026-10-17): aşağıdaki üç sınama tur denetiminin İKİ koşulunu AYRI AYRI ve çıkışın turu bayatlatmasını
  // ölçer. Önceki sınamalar yalnız ikisinin BİRLİKTE kaldırılmasını yakalıyordu: «yalnız tur numarası» ya da «yalnız hesap eşitliği»
  // ve «çıkış turu ilerletmez» mutasyonları yeşil kalıyordu.
  it('kimlikteki hesap DEĞİŞİR (dinleyici henüz ateşlenmedi), askıdaki okuma SONRA 200 döner → tur hiçbir şey yazmaz (`auth.currentUser` eşitliği)', async () => {
    durum.askiyaAl.add(GET_KENDI());
    const { container } = await ac('Admin', '/dashboard');
    expect(kendiOkumaSayisi()).toBe(1);
    durum.hesap = { ...durum.kullanici, uid: 'uid-baska-hesap' };   // Firebase oturumu başka hesaba geçti
    await birak(GET_KENDI(), 200, { data: { role: 'Admin', companyId: 'sirket-1', name: 'Deneme Kullanıcı' } });
    await bekle();
    expect(kabukVar(container)).toBe(false);
    expect(yoneticiMenusu(container)).toBe(false);
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
  });

  it('AYNI hesap çıkıp yeniden girer; ESKİ turun askıdaki okuması 200 Yönetici döner → yazılmaz (tur numarası); yeni turun sonucu (Satış) yazılır', async () => {
    durum.askiyaAl.add(GET_KENDI());
    const { container } = await ac('Admin', '/dashboard');
    expect(kendiOkumaSayisi()).toBe(1);
    durum.hesap = null;
    await act(async () => { await durum.oturumDinleyicisi?.(null); });
    durum.hesap = durum.kullanici;
    await act(async () => { await durum.oturumDinleyicisi?.(durum.kullanici); });
    await ilerlet(300);
    expect(kendiOkumaSayisi()).toBe(2);                                    // yeni turun okuması da askıda
    await birakIlk(GET_KENDI(), 200, { data: { role: 'Admin', companyId: 'sirket-1', name: 'Deneme Kullanıcı' } });
    await bekle();
    expect(kabukVar(container)).toBe(false);                               // yeni tur sürüyor: yükleniyor görünümü
    expect(yoneticiMenusu(container)).toBe(false);
    expect(durum.dinleyiciler).toEqual([]);
    await birak(GET_KENDI(), 200, { data: { role: 'Sales', companyId: 'sirket-1', name: 'Deneme Kullanıcı' } });
    await bekle();
    expect(kabukVar(container)).toBe(true);
    expect(yoneticiMenusu(container)).toBe(false);                         // eski turun Yönetici rolü TAŞINMADI
    expect(appDeposu.getState().userRole).toBe(UserRole.Sales);
  });

  it('«Yeniden dene» sürerken «Çıkış»: sunucu çıkışı beklenirken dönen profil okuması kabuğu açmaz (çıkış turu bayatlatır)', async () => {
    durum.kalici[GET_KENDI()] = SUNUCU_HATASI;
    const { container, getByRole } = await ac('Admin', '/dashboard');
    await ilerlet(15_000);
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    delete durum.kalici[GET_KENDI()];
    durum.askiyaAl.add(GET_KENDI());
    const cikisAnahtari = `POST ${CIKIS_UCU}`;
    durum.askiyaAl.add(cikisAnahtari);
    fireEvent.click(getByRole('button', { name: 'Yeniden dene' }));
    await ilerlet(100);
    expect(kendiOkumaSayisi()).toBe(5);
    fireEvent.click(getByRole('button', { name: 'Çıkış' }));
    await ilerlet(100);
    expect(durum.askida[cikisAnahtari]).toHaveLength(1);                   // sunucu çıkışı askıda; oturum henüz kapanmadı
    expect(durum.cikisSayisi).toBe(0);
    await birak(GET_KENDI(), 200, { data: { role: 'Admin', companyId: 'sirket-1', name: 'Deneme Kullanıcı' } });
    await bekle();
    expect(kabukVar(container)).toBe(false);
    expect(yoneticiMenusu(container)).toBe(false);
    expect(durum.dinleyiciler).toEqual([]);
    await birak(cikisAnahtari, 200, { ok: true });
    await bekle();
    expect(durum.cikisSayisi).toBe(1);
    expect(kabukVar(container)).toBe(false);
  });
});

// ── İ2-a (inceleme 2, 2026-10-17): çıkış sürerken «Yeniden dene» kabuğu AÇMAZ ─────────────────────────────────────────────
// Çıkış sunucu yanıtını beklerken (en çok 5 sn) oturum hâlâ açıktır: o arada basılan «Yeniden dene» yeni tur alıp çıkışın bayatlattığı
// turu geçiyor, Yönetici kabuğu açılıyor ve dinleyiciler başlıyordu. İki katman AYRI sınanır: (1) sayfanın düğmesi çıkış sürerken
// pasif; (2) App'in kapısı (`cikisSuruyorRef`) — düğme atlanıp işleyici doğrudan çağrılır (biri sökülürse kendi satırı kırmızı).
// Askıdaki okuma yok: çıkış başladıktan sonraki okuma BAŞARILI Yönetici döner — kapı açık kalırsa kabuk görünür.
describe('İ2-a — çıkış sürerken «Yeniden dene»: kabuk açılmaz, dinleyici 0', () => {
  const CIKIS = `POST ${CIKIS_UCU}`;

  /** «Profiliniz yüklenemedi.» sayfasına kadar açar, sonraki okumayı başarılı Yönetici yapar, «Çıkış»a basar (sunucu çıkışı askıda). */
  async function okunamadiVeCikisBaslat() {
    durum.kalici[GET_KENDI()] = SUNUCU_HATASI;
    const sonuc = await ac('Admin', '/dashboard');
    await ilerlet(15_000);
    expect(metin(sonuc.container)).toContain(PROFIL_YUKLENEMEDI);
    expect(kendiOkumaSayisi()).toBe(4);
    delete durum.kalici[GET_KENDI()];                                      // bundan sonraki okuma 200 Yönetici
    durum.askiyaAl.add(CIKIS);
    fireEvent.click(sonuc.getByRole('button', { name: 'Çıkış' }));
    await ilerlet(100);
    expect(durum.askida[CIKIS]).toHaveLength(1);                           // sunucu çıkışı askıda; oturum henüz kapanmadı
    expect(durum.cikisSayisi).toBe(0);
    return sonuc;
  }
  /** Askıdaki sunucu çıkışını yanıtlar; oturum kapanır, kabuk ve dinleyici yok. */
  async function cikisiBitir(kap: HTMLElement) {
    await birak(CIKIS, 200, { ok: true });
    await bekle();
    expect(durum.cikisSayisi).toBe(1);
    expect(metin(kap)).not.toContain(PROFIL_YUKLENEMEDI);
    expect(kabukVar(kap)).toBe(false);
    expect(durum.dinleyiciler).toEqual([]);
  }

  it('sayfa katmanı: önce «Çıkış», sonra «Yeniden dene» → düğme PASİF (etiket «Yeniden dene», «Deneniyor…» değil); okuma yok, kabuk yok, dinleyici 0', async () => {
    const { container, getByRole } = await okunamadiVeCikisBaslat();
    const dugme = getByRole('button', { name: 'Yeniden dene' }) as HTMLButtonElement;
    expect(dugme.disabled).toBe(true);
    fireEvent.click(dugme);
    await bekle();
    expect(kendiOkumaSayisi()).toBe(4);
    expect(kabukVar(container)).toBe(false);
    expect(yoneticiMenusu(container)).toBe(false);
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
    await cikisiBitir(container);
  });

  it('App kapısı: düğme atlanır, «Yeniden dene» işleyicisi çıkış sürerken DOĞRUDAN çağrılır → okuma yok, kabuk yok, dinleyici 0', async () => {
    const { container } = await okunamadiVeCikisBaslat();
    const sayfa = durum.profilEkrani;
    expect(sayfa, 'sayfanın özellikleri okunamadı (sarmal bağlı değil)').not.toBeNull();
    await act(async () => { sayfa?.onYenidenDene(); await vi.advanceTimersByTimeAsync(0); });
    await bekle();
    expect(kendiOkumaSayisi()).toBe(4);
    expect(kabukVar(container)).toBe(false);
    expect(yoneticiMenusu(container)).toBe(false);
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
    await cikisiBitir(container);
  });

  it('çıkış bitince kapı AÇILIR: aynı sekmede yeniden giriş, okuma 500 × 4 → «Yeniden dene» başarıda Yönetici menüsü', async () => {
    const { container, getByRole } = await okunamadiVeCikisBaslat();
    await cikisiBitir(container);
    durum.yanitlar[GET_KENDI()] = [SUNUCU_HATASI, SUNUCU_HATASI, SUNUCU_HATASI, SUNUCU_HATASI];
    durum.hesap = durum.kullanici;
    durum.dinleyiciler = []; istekler = []; akislar = [];
    await act(async () => { await durum.oturumDinleyicisi?.(durum.kullanici); });
    await ilerlet(15_000);
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    expect(kendiOkumaSayisi()).toBe(4);
    const dugme = getByRole('button', { name: 'Yeniden dene' }) as HTMLButtonElement;
    expect(dugme.disabled).toBe(false);
    fireEvent.click(dugme);
    await bekle();
    expect(kendiOkumaSayisi()).toBe(5);
    expect(yoneticiMenusu(container)).toBe(true);
    expect(durum.dinleyiciler).toContain('orders');
  });

  // Kaynak çiti: «hata verse de sıfırlanır» davranışla ölçülemez (`handleLogout`un adımları fırlatmaz) — sıfırlama `finally`de olmalı.
  it('kaynak: bayrak `handleLogout`ta turdan ÖNCE kurulur ve `finally`de sıfırlanır; «Yeniden dene» girişinde denetlenir', () => {
    const satirlar = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod.trim());
    const ilk = (bas: number, satir: string) => {
      const i = satirlar.findIndex((s, j) => j > bas && s === satir);
      expect(i, `App.tsx içinde bulunamadı: ${satir}`).toBeGreaterThan(bas);
      return i;
    };
    expect(satirlar.filter(s => /cikisSuruyorRef\.current = true;/.test(s))).toHaveLength(1);
    expect(satirlar.filter(s => /cikisSuruyorRef\.current = false;/.test(s))).toHaveLength(1);
    const cikis = ilk(-1, 'const handleLogout = async () => {');
    const kur = ilk(cikis, 'cikisSuruyorRef.current = true;');
    expect(satirlar[kur + 1]).toBe('try {');
    const tur = ilk(kur, 'acilisTuruRef.current += 1;');
    const sonra = ilk(tur, '} finally {');
    expect(satirlar[sonra + 1]).toBe('cikisSuruyorRef.current = false;');
    expect(satirlar.filter(s => s.startsWith('if (rolCozumSuruyorRef.current || cikisSuruyorRef.current || auth.currentUser?.uid !== u.uid) return;'))).toHaveLength(1);
  });
});

describe('R5′ — sahip kurulumu: rol yalnız `setDoc` BAŞARILIYSA; düşerse R2 sınıflandırması', () => {
  beforeEach(() => { durum.kullanici = { ...durum.kullanici, email: SAHIP }; });

  it.each([
    ['PUT 500', SUNUCU_HATASI],
    ['PUT 403 KAYIT_YOK', [403, { error: "Bu hesap için CETPA'da kullanıcı kaydı yok. Hesabınızı CETPA yöneticiniz açar.", code: 'KAYIT_YOK' }]],
  ] as Array<[string, SahteYanit]>)('belge yok + %s → menü yok (Admin sessizce atanmaz); üç deneme sonra «Profiliniz yüklenemedi.»', async (_ad, ret) => {
    durum.kalici[GET_KENDI()] = [404, { error: 'Not found.' }];
    durum.kalici[`PUT ${kendiYolu()}`] = ret;
    const { container } = await ac('Admin', '/dashboard');
    expect(kabukVar(container)).toBe(false);
    await ilerlet(15_000);
    expect(kendiYazimlari('PUT')).toBe(4);                                 // «Yeniden dene» gibi her deneme kurulumun TAMAMINI koşar
    expect(kabukVar(container)).toBe(false);
    expect(yoneticiMenusu(container)).toBe(false);
    expect(metin(container)).toContain(PROFIL_YUKLENEMEDI);
    expect([durum.cikisSayisi, durum.silinen]).toEqual([0, []]);           // kayıtsız hesap dalına düşmez
    expect(durum.dinleyiciler).toEqual([]);
  });

  it('belge yok + PUT 200 → kurulum yazılır, rol Yönetici (bugünkü kurulum dalı)', async () => {
    durum.kalici[GET_KENDI()] = [404, { error: 'Not found.' }];
    const { container } = await ac('Admin', '/dashboard');
    expect(kendiYazimlari('PUT')).toBe(1);
    expect(yoneticiMenusu(container)).toBe(true);
  });
});

describe('R1′ — «rol atanmamış» hesap: ekran bugünkü yerinde, veri BAŞLAMAZ', () => {
  it('rolsüz kayıt: «rol atanmamış» uyarısı; izin dışı istek 0, dinleyici 0, akış bağlantısı 0, 90 sn zamanlayıcısı yok', async () => {
    const { container } = await ac(undefined, '/dashboard');
    expect(metin(container)).toContain('Hesabınıza rol atanmamış');
    await ilerlet(15_000);
    expect(izinDisi()).toEqual([]);
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
    expect(araliklar).not.toContain(90_000);
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
    // Rol kapısı (R1) dış rol kapısından ÖNCE: profil okuması düşen bayi de iç menüyü / bayi sayfasını görmez (R6).
    expect(kapi).toBeGreaterThan(sira("if (user && rolDurumu !== 'cozuldu') {"));
    expect(kapi).toBeLessThan(sira('const uygulamaYolundaMi ='));
    expect(kapi).toBeLessThan(sira('if (!user && !isGuestMode) {'));
    expect(kapi).toBeLessThan(sira('if (baglanSayfasi && user) {'));
  });

  it('R — veri kapısı TEK türetilmiş değer; rol kapısı ve «Profiliniz yüklenemedi.» sayfası bağlı (yazıldı ama bağlanmadı çiti)', () => {
    expect(say(/^\s*const veriOturumu = veriOturumuSec\(user, rolDurumu, roleMissing\);$/)).toBe(1);
    expect(say(/veriOturumuSec\(/)).toBe(1);
    expect(say(/<ProfilYuklenemediEkrani$/)).toBe(1);
    expect(say(/onYenidenDene=\{\(\) => profiliYenidenCozRef\.current\?\.\(user\)\}/)).toBe(1);
    expect(say(/^\s*profiliYenidenCozRef\.current = \(u: User\) => \{$/)).toBe(1);
    expect(kod).toContain("import ProfilYuklenemediEkrani from './components/ProfilYuklenemediEkrani';");
    // Yönlendirme efekti yalnız `'cozuldu'`da koşar (R1″).
    expect(say(/^\s*if \(!isAuthReady \|\| !user \|\| rolDurumu !== 'cozuldu'\) return;$/)).toBe(1);
  });

  it('sekme kapılı dinleyiciler `activeTab`i DOĞRUDAN almaz: veri sekmesinden geçer', () => {
    // 2026-10-17 (R1′): oturum veri kapısından (`veriOturumu`) gelir — rol çözülmeden sekme kapılı dinleyici açılmaz (bilerek değişti).
    expect(say(/^\s*const veriSekme = veriSekmesi\(\{ oturumVar: !!veriOturumu, rol: userRole, sekme: activeTab \}\);$/)).toBe(1);
    expect(say(/useSekmeVerileri\(\{ user: veriOturumu, activeTab: veriSekme, /)).toBe(1);
    expect(say(/useSekmeVerileri\(/)).toBe(1);
    expect(say(/if \(veriSekme !== 'inventory' \|\| p584Active\) return;/)).toBe(1);
  });
});

// ── «Yeni sürüm yayında» şeridi GERÇEK App'te (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S3: giriş ekranında ve dış rol
// sayfasında da çalışır) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Şerit App kökünde, hata sınırının dışında (`App` → `<YeniSurumSeridi />`). Gömülü kimlik `index.html` meta'sıdır (derleme
// eklentisi); sınamada elle konur — öbür sınamalarda meta YOKTUR, şerit denetimi hiç başlamaz (istek / zamanlayıcı yok).
describe('«yeni sürüm» şeridi: her sayfada (oturumsuz karşılama ve giriş ekranı, dış rol sayfası, kabuk)', () => {
  const GOMULU = 'aaaaaaaaaaaaaaaa';
  const YENI = 'bbbbbbbbbbbbbbbb';
  const METIN_YENI = 'Yeni sürüm yayında. Kaydedilmemiş işiniz yoksa yenileyin.';
  let seritDeposu: typeof import('../lib/yeniSurum').seritDeposu;
  let surumDenetimAraligi = 0;
  beforeAll(async () => {
    const m = await import('../lib/yeniSurum');
    seritDeposu = m.seritDeposu;
    surumDenetimAraligi = m.SURUM_DENETIM_ARALIGI_MS;
  });
  beforeEach(() => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'cetpa-surum');
    meta.setAttribute('content', GOMULU);
    document.head.appendChild(meta);
    durum.sunucuSurumu = YENI;
  });
  afterEach(() => {
    document.head.querySelectorAll('meta[name="cetpa-surum"]').forEach(m => m.remove());
    seritDeposu.gizle();
  });
  const bes = () => act(async () => { await vi.advanceTimersByTimeAsync(surumDenetimAraligi); });
  const surumIstegi = () => istekler.filter(i => i.yol === '/api/surum').map(i => i.yontem);
  const seritMetni = (kap: HTMLElement) => kap.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '';

  it.each([
    ['oturumsuz karşılama', null, '/'],
    ['oturumsuz giriş ekranı', null, MAGAZA_PANEL_BAGLAN_YOLU],
    ...EXTERNAL_ROLES.map(r => [`dış rol ${r} sayfası`, r, '/dashboard'] as const),
    ['iç rol kabuğu', 'Sales', '/dashboard'],
  ] as const)('%s: 5 dk sonra sorar, farklı sürümde şerit çıkar', async (_ad, rol, yol) => {
    durum.rol = rol ?? undefined;
    const { container } = await (async () => {
      if (rol !== null) return ac(rol, yol);
      durum.hesap = null; durum.yuklendi = false;
      istekler = [];
      window.history.pushState({}, '', yol);
      tazele();
      const sonuc = render(<BrowserRouter><App /></BrowserRouter>);
      await bekle();
      return sonuc;
    })();
    if (rol === null && yol === MAGAZA_PANEL_BAGLAN_YOLU) expect(container.querySelector('input[type="password"]')).not.toBeNull();   // gerçekten giriş ekranı
    if (rol !== null && rol !== 'Sales') expect(bayiBasligi(container)).not.toBeNull();
    expect(surumIstegi()).toEqual([]);                             // açılışta sorulmaz
    expect(seritMetni(container)).toBe('');
    await bes();
    expect(surumIstegi()).toEqual(['GET']);
    expect(seritMetni(container)).toContain(METIN_YENI);
    if (rol !== null && rol !== 'Sales') expect(izinDisi()).toEqual([]);   // dış rolde şerit izin dışı istek açmaz
  }, 120_000);

  it('aynı sürüm → şerit yok; şerit kapatılınca aynı sürüm için bir daha çıkmaz', async () => {
    durum.sunucuSurumu = GOMULU;
    const { container, getByRole } = await ac(EXTERNAL_ROLES[0], '/dashboard');
    await bes();
    expect(surumIstegi()).toEqual(['GET']);
    expect(seritMetni(container)).toBe('');
    durum.sunucuSurumu = YENI;
    await bes();
    expect(seritMetni(container)).toContain(METIN_YENI);
    fireEvent.click(getByRole('button', { name: 'Bildirimi kapat' }));
    await bes();
    expect(surumIstegi()).toEqual(['GET', 'GET', 'GET']);
    expect(seritMetni(container)).toBe('');
  }, 120_000);
});

describe('kendiliğinden yenileme YOK (S4): eksik parça hatası sayfayı yenilemez', () => {
  it('TabErrorBoundary eksik parçada zamanlayıcıyla yenilemez; yenileme yalnız düğmede', () => {
    const satirlar = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod);
    const bas = satirlar.findIndex(s => s.includes('class TabErrorBoundary extends React.Component<'));
    const son = satirlar.findIndex((s, i) => i > bas && /^\}$/.test(s));        // sınıfın kapanışı (sütun 0)
    expect(bas).toBeGreaterThan(-1);
    expect(son).toBeGreaterThan(bas);
    const govde = satirlar.slice(bas, son).join('\n');
    expect(govde).not.toMatch(/setTimeout\(\(\) => window\.location\.reload\(\)/);
    expect(govde).not.toMatch(/cetpa_chunk_reload/);
    expect(govde).toMatch(/if \(isChunkError\) this\.parcaHatasindanYenile\(\);/);
    // `componentDidCatch` yalnız günlüğe yazar.
    const yakala = govde.slice(govde.indexOf('componentDidCatch(error: Error) {'), govde.indexOf('private parcaHatasindanYenile() {'));
    expect(yakala).not.toMatch(/reload|sessionStorage|serviceWorker|caches/);
  });
  it('şerit App kökünde, hata sınırının DIŞINDA tek kez bağlı («yazıldı ama bağlanmadı» çiti)', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod).join('\n');
    expect(kod.match(/<YeniSurumSeridi \/>/g)).toHaveLength(1);
    expect(kod).toMatch(/<\/ErrorBoundary>\n\s+<YeniSurumSeridi \/>\n\s+<\/>/);
  });
});
