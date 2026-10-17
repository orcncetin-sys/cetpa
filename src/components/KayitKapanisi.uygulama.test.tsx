// @vitest-environment jsdom
/**
 * KayitKapanisi.uygulama.test.tsx — herkese açık kaydın kapanması, UYGULAMA düzeyinde (şartname
 * `.wf/SARTNAME-kayit-kapanisi-ve-kurus.md` A1 / A2 · T1 / T2; T5'in istemci yarısı). GERÇEK `App.tsx` çizilir; sunucu yarısı
 * (A4 · T3) `src/server/kucukKapanislar.zincir.test.ts` içindeki «T3 (A4)» bölümünde.
 *
 * DÜZENEK `DisRolEkrani.uygulama.test.tsx` ile AYNI kalıp: sahte olanlar YALNIZ dış dünya — Firebase kimliği (`firebase/auth`,
 * `../firebase`), `fetch`, `EventSource`, zaman. `lib/dbClient` GERÇEKTİR (istek yolları üretimdekiyle aynı koddan çıkar). Tembel
 * sayfalar (`React.lazy`) boş çizilir; tek fark: `onLoginClick` alan tembel sayfa (karşılama sayfası) bir düğme verir — giriş
 * ekranına kullanıcının yolundan geçilir.
 *
 * Sahte Firebase, gerçeği gibi, oturum kapanınca (çıkış ya da hesap silme) dinleyiciyi `null` ile ATEŞLER — üstelik çağıranın
 * beklemesi sürerken (mikro görev): kapanmış oturumun açılış turunun sonunda geri açılmadığı böyle ölçülür.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type React from 'react';
import { join } from 'node:path';
import { signInWithPopup } from 'firebase/auth';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';

const UID = 'uid-kayit-1';
const SAHIP = 'orcncetin@gmail.com';
// Gerçek App çizilir; yük altında (bütün takım koşarken) tek açılış saniyeyi bulabilir.
vi.setConfig({ testTimeout: 60_000 });

interface SahteKullanici {
  uid: string; email: string | null; displayName: string; photoURL: string; isAnonymous: boolean; emailVerified: boolean;
  tenantId: null; providerData: unknown[]; getIdToken: () => Promise<string>;
  metadata: { creationTime?: string; lastSignInTime?: string };
}
const durum = vi.hoisted(() => ({
  /** `users/<uid>` belgesi; `null` = CETPA'da kullanıcı kaydı YOK. */
  belge: { role: 'Sales' } as Record<string, unknown> | null,
  /** Kendi belgesinin okuması 403 dönsün mü (iki adımlı doğrulama bekleyen oturum). */
  belgeKapali: false,
  ikiAdim: { enabled: false, verified: false },
  /** `/api/invites/redeem` yanıtı: kabul → sunucu belgeyi rolle yazar; ret → kalıcı ret (başka e-posta). */
  davet: 'kabul' as 'kabul' | 'ret',
  hesap: null as SahteKullanici | null,
  yuklendi: false,
  oturumDinleyicisi: null as ((u: unknown) => void | Promise<void>) | null,
  cikisSayisi: 0,
  /** `deleteUser` ile silinen kimlik hesapları (uid). */
  silinen: [] as string[],
  silmeHatasi: false,
  /** Yönlendirmeli girişin sonucu bu kodla düşsün (`null` = sonuç yok). */
  yonlendirmeHatasi: null as string | null,
  dinleyiciler: [] as string[],
}));

vi.mock('firebase/auth', () => {
  /** Gerçek Firebase gibi: oturum kapanınca dinleyiciler `null` ile ateşlenir (çağıranın beklemesi sırasında, mikro görevde). */
  const oturumuKapat = () => {
    if (!durum.hesap) return;
    durum.hesap = null;
    queueMicrotask(() => { void durum.oturumDinleyicisi?.(null); });
  };
  return {
    getAuth: () => ({ get currentUser() { return durum.yuklendi ? durum.hesap : null; } }),
    onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void | Promise<void>) => {
      durum.oturumDinleyicisi = cb;
      queueMicrotask(() => { durum.yuklendi = true; void cb(durum.hesap); });
      return () => {};
    },
    signOut: async () => { durum.cikisSayisi += 1; oturumuKapat(); },
    deleteUser: async (u: { uid: string }) => {
      if (durum.silmeHatasi) throw Object.assign(new Error('ağ hatası (sınama)'), { code: 'auth/network-request-failed' });
      durum.silinen.push(u.uid);
      oturumuKapat();
    },
    getRedirectResult: async () => {
      if (durum.yonlendirmeHatasi) throw Object.assign(new Error('yönlendirme sonucu (sınama)'), { code: durum.yonlendirmeHatasi });
      return null;
    },
    GoogleAuthProvider: class { setCustomParameters() {} },
    signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), signInWithEmailAndPassword: vi.fn(),
    sendEmailVerification: vi.fn(), sendPasswordResetEmail: vi.fn(),
  };
});
vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: {
    get currentUser() { return durum.yuklendi ? durum.hesap : null; },
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
  const asil = await asilAl<typeof import('react') & { default: typeof import('react') }>();
  // Tembel sayfalar boş; yalnız karşılama sayfası (`onLoginClick` alan TEK tembel sayfa) giriş düğmesi çizer.
  const lazy = () => (p: { onLoginClick?: () => void }) =>
    p.onLoginClick ? asil.createElement('button', { type: 'button', onClick: p.onLoginClick }, 'Karşılama: giriş') : null;
  return { ...asil, lazy, default: { ...asil.default, lazy } };
});

interface Istek { yontem: string; yol: string; govde: unknown }
let istekler: Istek[] = [];
let akislar: string[] = [];

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
  if (yol === '/api/mfa/status') return Promise.resolve(yanit(durum.ikiAdim));
  if (yol === '/api/invites/redeem' && yontem === 'POST') {
    if (durum.davet === 'ret') return Promise.resolve(yanit({ success: false, error: 'Bu davet başka bir e-posta adresi için oluşturulmuş.' }, 403));
    durum.belge = { role: 'Sales', companyId: 'sirket-1' };   // sunucu belgeyi YAZAR (istemci değil)
    return Promise.resolve(yanit({ success: true, role: 'Sales', companyId: 'sirket-1' }));
  }
  if (yol === `/api/db/users/${UID}` && yontem === 'GET') {
    // Sunucunun `requireMfaVerified`'ı gibi: doğrulaması açık ve doğrulanmamış hesapta 403 gövdesi `mfaRequired: true` taşır
    // (2026-10-17, şartname R2: doğrulama penceresini bu alan açar — gövdesiz 403 yeniden denenir; düzenek gerçeğe uyduruldu).
    if (durum.belgeKapali) {
      const mfa = durum.ikiAdim.enabled && !durum.ikiAdim.verified;
      return Promise.resolve(yanit({ error: 'İki adımlı doğrulama gerekli', ...(mfa ? { mfaRequired: true } : {}) }, 403));
    }
    if (durum.belge === null) return Promise.resolve(yanit({ error: 'Not found.' }, 404));
    return Promise.resolve(yanit({ data: { ...durum.belge, name: 'Deneme Kullanıcı' } }));
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

const SIMDI = new Date('2026-10-17T09:00:00+03:00');
const utc = (ms: number): string => new Date(ms).toUTCString();
const kullanici = (ek: Partial<SahteKullanici> = {}): SahteKullanici => ({
  uid: UID, email: 'deneme@ornek.test', displayName: 'Deneme Kullanıcı', photoURL: '', isAnonymous: false, emailVerified: true,
  tenantId: null, providerData: [], getIdToken: async () => 'belirtec-deneme',
  metadata: { creationTime: 'Mon, 02 Feb 2026 08:00:00 GMT', lastSignInTime: utc(SIMDI.getTime() - 4_000) },
  ...ek,
});
/** Bu girişte açılmış hesap (Google ile İLK giriş): açılış = son giriş, birkaç saniye önce. */
const yeniHesap = (ek: Partial<SahteKullanici> = {}): SahteKullanici =>
  kullanici({ metadata: { creationTime: utc(SIMDI.getTime() - 4_000), lastSignInTime: utc(SIMDI.getTime() - 4_000) }, ...ek });

let App: React.ComponentType;
let tazele: () => void;
beforeAll(async () => {
  App = (await import('../App')).default;
  const { resetStream } = await import('../lib/dbClient');
  const { resetLazyCollections } = await import('../lib/lazyCollections');
  const { useAppStore } = await import('../store/appStore');
  tazele = () => { resetStream(); resetLazyCollections(); useAppStore.setState(useAppStore.getInitialState()); };
}, 180_000);

beforeEach(() => {
  istekler = []; akislar = [];
  durum.belge = { role: 'Sales' }; durum.belgeKapali = false; durum.ikiAdim = { enabled: false, verified: false }; durum.davet = 'kabul';
  durum.hesap = null; durum.yuklendi = false; durum.oturumDinleyicisi = null; durum.cikisSayisi = 0; durum.silinen = [];
  durum.silmeHatasi = false; durum.yonlendirmeHatasi = null; durum.dinleyiciler = [];
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
const bekle = () => act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

/** Uygulamayı verilen hesapla (saklı oturum; `null` = oturumsuz) açar; açılış efektleri tamamlanınca döner. */
async function ac(hesap: SahteKullanici | null, yol = '/') {
  durum.hesap = hesap; durum.yuklendi = false;
  window.history.pushState({}, '', yol);
  tazele();
  const sonuc = render(<BrowserRouter><App /></BrowserRouter>);
  await bekle();
  return sonuc;
}

const KAYITSIZ = "Bu hesap için CETPA'da kullanıcı kaydı yok. Hesabınızı CETPA yöneticiniz açar.";
const DAVETLI = 'Davetiniz kabul edilemedi: bu kurulumda yeni hesabı yalnız CETPA yöneticiniz açabilir. Yöneticinizden sizin için «Kullanıcı Ekle (manuel)» ile hesap açmasını isteyin.';
const DAVETLI_EN = 'Your invitation could not be accepted: in this installation only your CETPA administrator can create new accounts. Ask your administrator to create an account for you with "Add User (manual)".';
const davetKabulIstekleri = () => istekler.filter(i => i.yol === '/api/invites/redeem');
const NOT = 'Hesabınızı CETPA yöneticiniz açar.';
const kabukVar = (kap: HTMLElement) => kap.querySelector('nav') !== null || kap.querySelector('aside') !== null;
const metin = (kap: HTMLElement) => kap.textContent ?? '';
const dugmeler = (kap: HTMLElement) => [...kap.querySelectorAll('button')].map(b => (b.textContent ?? '').trim());
/** Kendi `users` belgesine giden YAZIMLAR (yöntem tünelden sonraki asıl yöntemdir). */
const belgeYazimlari = () => istekler.filter(i => i.yol === `/api/db/users/${UID}` && i.yontem !== 'GET');
const girisEkrani = (kap: HTMLElement) => dugmeler(kap).includes('Şifremi Unuttum');

// ═══ T1 — giriş ekranı (A1) ════════════════════════════════════════════════════════════════════════════════════════════════
describe('T1 (A1) — giriş ekranında kayıt sekmesi / formu / metni YOK; Google ile giriş ve şifre sıfırlama duruyor', () => {
  /** Oturumsuz açılış → karşılama sayfası → «giriş». */
  async function girisEkraniniAc() {
    const sonuc = await ac(null);
    expect(dugmeler(sonuc.container)).toContain('Karşılama: giriş');   // düzenek canlı: karşılama sayfası çizildi
    fireEvent.click(sonuc.getByText('Karşılama: giriş'));
    await bekle();
    expect(girisEkrani(sonuc.container)).toBe(true);
    return sonuc;
  }

  it('Türkçe: «Kayıt Ol» sekmesi, kayıt formu ve kayıt metni yok; yerinde «Hesabınızı CETPA yöneticiniz açar.»', async () => {
    const { container } = await girisEkraniniAc();
    const t = metin(container);
    for (const yok of ['Kayıt Ol', 'Hesap Oluştur', 'HESAP OLUŞTUR', 'AD SOYAD', 'ŞİFRE TEKRAR', 'Kayıt olarak', 'kayıt olun']) expect(t, yok).not.toContain(yok);
    expect(container.querySelectorAll('input[autocomplete="new-password"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);   // yalnız giriş formunun şifresi
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(dugmeler(container)).toEqual(expect.arrayContaining(['GİRİŞ YAP', 'Google ile Giriş Yap', 'Şifremi Unuttum']));
    expect(t).toContain(NOT);
  });

  it('İngilizce: «Sign Up» / «Create Account» yok; not İngilizce', async () => {
    const { container, getByText } = await girisEkraniniAc();
    fireEvent.click(getByText('EN'));
    await bekle();
    const t = metin(container);
    for (const yok of ['Sign Up', 'Create Account', 'CREATE ACCOUNT', 'FULL NAME', 'CONFIRM PASSWORD', 'By registering']) expect(t, yok).not.toContain(yok);
    expect(t).toContain('Your CETPA administrator creates your account.');
    expect(dugmeler(container)).toEqual(expect.arrayContaining(['SIGN IN', 'Sign in with Google', 'Forgot password?']));
  });

  it('«Şifremi Unuttum» sıfırlama formunu açar, «← Giriş Yap» geri döner (sıfırlama akışı bozulmadı)', async () => {
    const { container, getByText } = await girisEkraniniAc();
    fireEvent.click(getByText('Şifremi Unuttum'));
    await bekle();
    expect(container.querySelector('h1')?.textContent).toBe('Şifre Sıfırla');
    expect(dugmeler(container)).toContain('SIFIRLAMA BAĞLANTISI GÖNDER');
    fireEvent.click(getByText('← Giriş Yap'));
    await bekle();
    expect(girisEkrani(container)).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('Hoş Geldiniz');
  });

  it('Firebase yeni hesabı reddederse (konsolda «Oluşturmayı etkinleştir» kapalı — A5) Google girişi aynı iletiyi gösterir', async () => {
    const { container, getByText } = await girisEkraniniAc();
    vi.mocked(signInWithPopup).mockRejectedValueOnce(Object.assign(new Error('kısıtlı'), { code: 'auth/admin-restricted-operation' }));
    fireEvent.click(getByText('Google ile Giriş Yap'));
    await bekle();
    expect(metin(container)).toContain(KAYITSIZ);
    expect(metin(container).split(NOT)).toHaveLength(2);   // not iletiyle birlikte TEKRARLANMAZ
  });

  it('yönlendirmeli Google girişi aynı kodla dönerse: sayfa açılışında giriş ekranı ve aynı ileti (karşılama sayfası değil)', async () => {
    durum.yonlendirmeHatasi = 'auth/admin-restricted-operation';
    const { container } = await ac(null);
    expect(dugmeler(container)).not.toContain('Karşılama: giriş');
    expect(girisEkrani(container)).toBe(true);
    expect(metin(container)).toContain(KAYITSIZ);
  });

  // İ1-a (inceleme 1, 2026-10-17): konsolda kayıt kapatılırsa (A5) yeni davetli kimlik hesabı AÇAMAZ, davet kabulü oturum ister → davet
  // akışı kapanır. Bekleyen davet varsa iki daldaki ileti davetliye yolu söyler; davet kabul isteği hiç gitmez (oturum yok).
  it('İ1-a — bekleyen davet + Google girişi `auth/admin-restricted-operation`: davetliye özel ileti; davet kabul isteği 0', async () => {
    sessionStorage.setItem('cetpa_pending_invite', 'davet-kodu-3');
    const { container, getByText } = await girisEkraniniAc();
    vi.mocked(signInWithPopup).mockRejectedValueOnce(Object.assign(new Error('kısıtlı'), { code: 'auth/admin-restricted-operation' }));
    fireEvent.click(getByText('Google ile Giriş Yap'));
    await bekle();
    expect(metin(container)).toContain(DAVETLI);
    expect(metin(container)).not.toContain(KAYITSIZ);
    expect(davetKabulIstekleri()).toEqual([]);
    expect(sessionStorage.getItem('cetpa_pending_invite')).toBe('davet-kodu-3');   // davet silinmez (yönetici hesabı açınca kullanılır)
  });

  it('İ1-a — bekleyen davet + yönlendirmeli giriş aynı kodla: giriş ekranı ve davetliye özel ileti; davet kabul isteği 0', async () => {
    sessionStorage.setItem('cetpa_pending_invite', 'davet-kodu-4');
    durum.yonlendirmeHatasi = 'auth/admin-restricted-operation';
    const { container } = await ac(null);
    expect(girisEkrani(container)).toBe(true);
    expect(metin(container)).toContain(DAVETLI);
    expect(metin(container)).not.toContain(KAYITSIZ);
    expect(davetKabulIstekleri()).toEqual([]);
  });

  it('İ1-a — İngilizce: davetliye özel ileti İngilizce', async () => {
    sessionStorage.setItem('cetpa_pending_invite', 'davet-kodu-5');
    const { container, getByText } = await girisEkraniniAc();
    fireEvent.click(getByText('EN'));
    await bekle();
    vi.mocked(signInWithPopup).mockRejectedValueOnce(Object.assign(new Error('kısıtlı'), { code: 'auth/admin-restricted-operation' }));
    fireEvent.click(getByText('Sign in with Google'));
    await bekle();
    expect(metin(container)).toContain(DAVETLI_EN);
    expect(davetKabulIstekleri()).toEqual([]);
  });

  it('yönlendirme sonucunun BAŞKA hatası iletiyi göstermez, karşılama sayfası açılır (bugünkü gibi)', async () => {
    durum.yonlendirmeHatasi = 'auth/network-request-failed';
    const { container } = await ac(null);
    expect(dugmeler(container)).toContain('Karşılama: giriş');
    expect(metin(container)).not.toContain(KAYITSIZ);
  });
});

// ═══ T2 — oturum açılışı (A2) ══════════════════════════════════════════════════════════════════════════════════════════════
describe('T2 (A2) — kayıtsız hesap: sahip → kurulum, davet → kabul, ikisi de değil → hesap açılmaz', () => {
  it('(a) kayıtsız + sahip e-postası: bugünkü kurulum dalı — kendi belgesi `role: Admin` ile yazılır, kabuk açılır', async () => {
    durum.belge = null;
    const { container } = await ac(yeniHesap({ email: SAHIP }), '/dashboard');
    const yazim = belgeYazimlari();
    expect(yazim.map(i => i.yontem)).toEqual(['PUT']);
    expect(yazim[0].govde).toMatchObject({ role: 'Admin', email: SAHIP });
    expect(durum.silinen).toEqual([]);
    expect(durum.cikisSayisi).toBe(0);
    expect(kabukVar(container)).toBe(true);
  });

  it('(b) kayıtsız + bekleyen davet: davet kabul edilir (belgeyi SUNUCU yazar), istemci yalnız günceller; hesap silinmez', async () => {
    durum.belge = null;
    sessionStorage.setItem('cetpa_pending_invite', 'davet-kodu-1');
    const { container } = await ac(yeniHesap(), '/dashboard');
    expect(istekler.filter(i => i.yol === '/api/invites/redeem').map(i => [i.yontem, i.govde])).toEqual([['POST', { token: 'davet-kodu-1' }]]);
    expect(belgeYazimlari().map(i => i.yontem)).toEqual(['PATCH']);   // var olan belgeye giriş bilgisi; oluşturma (PUT) yok
    expect(durum.silinen).toEqual([]);
    expect(durum.cikisSayisi).toBe(0);
    expect(kabukVar(container)).toBe(true);
    expect(sessionStorage.getItem('cetpa_pending_invite')).toBeNull();
  });

  it('(c) kayıtsız, YENİ hesap (Google ile ilk giriş): `users` yazılmaz, hesap silinir, oturum kapanır, giriş ekranı nedeni söyler', async () => {
    durum.belge = null;
    const { container } = await ac(yeniHesap(), '/dashboard');
    expect(belgeYazimlari()).toEqual([]);
    expect(durum.silinen).toEqual([UID]);
    expect(durum.hesap).toBeNull();
    expect(kabukVar(container)).toBe(false);
    expect(girisEkrani(container)).toBe(true);
    expect(metin(container)).toContain(KAYITSIZ);
    expect(metin(container)).not.toContain('Hesabınıza rol atanmamış');
    // Uygulama verisi hiç istenmedi: dinleyici, akış, kendi belgesi dışında `/api/db/` isteği yok.
    expect(durum.dinleyiciler).toEqual([]);
    expect(akislar).toEqual([]);
    expect(istekler.filter(i => i.yol.startsWith('/api/db/') && i.yol !== `/api/db/users/${UID}`)).toEqual([]);
  });

  it('(c) saklı oturumla kök adresten açılış: karşılama sayfası DEĞİL giriş ekranı açılır (ileti görünsün)', async () => {
    durum.belge = null;
    const { container } = await ac(yeniHesap(), '/');
    expect(dugmeler(container)).not.toContain('Karşılama: giriş');
    expect(girisEkrani(container)).toBe(true);
    expect(metin(container)).toContain(KAYITSIZ);
  });

  it('(c) ESKİ hesap (açılış ≠ son giriş): SİLİNMEZ, yalnız oturum kapanır; `users` yazılmaz', async () => {
    durum.belge = null;
    const { container } = await ac(kullanici(), '/dashboard');
    expect(belgeYazimlari()).toEqual([]);
    expect(durum.silinen).toEqual([]);
    expect(durum.cikisSayisi).toBe(1);
    expect(durum.hesap).toBeNull();
    expect(kabukVar(container)).toBe(false);
    expect(metin(container)).toContain(KAYITSIZ);
  });

  it.each([
    ['açılış = son giriş ama iki gün önce (saklı oturum, bir daha girilmemiş)', { creationTime: utc(SIMDI.getTime() - 2 * 86_400_000), lastSignInTime: utc(SIMDI.getTime() - 2 * 86_400_000) }],
    // Yakınlık tek başına YETMEZ: hesap pencerenin içinde açılmış ama o girişten SONRA yeniden girilmiş (ör. yöneticinin üç dakika
    // önce «Kullanıcı Ekle (manuel)» ile açtığı, kaydı sonra kaldırılmış hesap; parola bağlantısıyla ilk giriş) — bu girişte açılmadı.
    ['üç dakika önce açılmış ama sonra yeniden girilmiş (açılış ≠ son giriş, pencerenin içinde)', { creationTime: utc(SIMDI.getTime() - 3 * 60_000), lastSignInTime: utc(SIMDI.getTime() - 4_000) }],
    ['zaman bilgisi yok', {}],
    ['zaman bilgisi okunamıyor', { creationTime: 'bozuk', lastSignInTime: 'bozuk' }],
  ])('(c) yeni olduğu KESİN değil (%s): SİLİNMEZ, oturum kapanır', async (_ad, metadata) => {
    durum.belge = null;
    const { container } = await ac(kullanici({ metadata }), '/dashboard');
    expect(belgeYazimlari()).toEqual([]);
    expect(durum.silinen).toEqual([]);
    expect(durum.cikisSayisi).toBe(1);
    expect(kabukVar(container)).toBe(false);
    expect(metin(container)).toContain(KAYITSIZ);
  });

  it('(c) silme başarısız: oturum YİNE kapanır, ileti görünür, `users` yazılmaz', async () => {
    durum.belge = null;
    durum.silmeHatasi = true;
    const { container } = await ac(yeniHesap(), '/dashboard');
    expect(durum.silinen).toEqual([]);
    expect(durum.cikisSayisi).toBe(1);
    expect(durum.hesap).toBeNull();
    expect(belgeYazimlari()).toEqual([]);
    expect(kabukVar(container)).toBe(false);
    expect(metin(container)).toContain(KAYITSIZ);
  });

  it('(c) davet UYGULANAMADI (başka e-posta): kayıt yine yok → hesap açılmaz; ileti davetin hatasını da söyler', async () => {
    durum.belge = null;
    durum.davet = 'ret';
    sessionStorage.setItem('cetpa_pending_invite', 'davet-kodu-2');
    const { container } = await ac(yeniHesap(), '/dashboard');
    expect(istekler.filter(i => i.yol === '/api/invites/redeem')).toHaveLength(1);
    expect(belgeYazimlari()).toEqual([]);
    expect(durum.silinen).toEqual([UID]);
    expect(kabukVar(container)).toBe(false);
    expect(metin(container)).toContain('Davet uygulanamadı: Bu davet başka bir e-posta adresi için oluşturulmuş.');
    expect(metin(container)).toContain(KAYITSIZ);
  });

  it('(c) anonim hesap da kayıtsız sayılır: eski «anonim → Admin» kurulumu yok', async () => {
    durum.belge = null;
    const { container } = await ac(yeniHesap({ isAnonymous: true, email: null }), '/dashboard');
    expect(belgeYazimlari()).toEqual([]);
    expect(durum.cikisSayisi).toBe(1);
    expect(kabukVar(container)).toBe(false);
  });

  it('(c) sonra AYNI sekmede kayıtlı hesapla giriş: ileti ve giriş ekranı kalkar, kabuk açılır', async () => {
    durum.belge = null;
    const { container } = await ac(yeniHesap(), '/dashboard');
    expect(metin(container)).toContain(KAYITSIZ);
    durum.belge = { role: 'Sales' };
    durum.hesap = kullanici();
    await act(async () => { await durum.oturumDinleyicisi?.(durum.hesap); });
    await bekle();
    expect(kabukVar(container)).toBe(true);
    expect(metin(container)).not.toContain(KAYITSIZ);
  });
});

describe('T2 (A2) — VAR OLAN hesap: bugünkü akış AYNEN (hesap silinmez, oturum kapanmaz, belge oluşturulmaz)', () => {
  const degismedi = () => {
    expect(durum.silinen).toEqual([]);
    expect(durum.cikisSayisi).toBe(0);
    expect(belgeYazimlari().map(i => i.yontem).filter(y => y !== 'PATCH')).toEqual([]);
  };

  it('iç rol (Satış): kabuk açılır, giriş bilgisi PATCH ile güncellenir — hesap bu girişte açılmış olsa da (yönetici açtı) silinmez', async () => {
    const { container } = await ac(yeniHesap(), '/dashboard');
    expect(belgeYazimlari().map(i => i.yontem)).toEqual(['PATCH']);
    expect(kabukVar(container)).toBe(true);
    degismedi();
  });

  it('rolsüz kayıt (belge var, rol yok): «rol atanmamış» ekranı bugünkü gibi', async () => {
    durum.belge = { companyId: 'sirket-1' };
    const { container } = await ac(kullanici(), '/dashboard');
    expect(metin(container)).toContain('Hesabınıza rol atanmamış');
    expect(metin(container)).not.toContain(KAYITSIZ);
    degismedi();
  });

  it('iki adımlı doğrulama bekleyen oturum (kendi belgesi 403): doğrulama penceresi çizilir, kayıtsız sayılmaz', async () => {
    durum.belgeKapali = true;
    durum.ikiAdim = { enabled: true, verified: false };
    const { container } = await ac(kullanici(), '/dashboard');
    expect(metin(container)).toContain('İki Faktörlü Doğrulama');
    expect(metin(container)).not.toContain(KAYITSIZ);
    expect(belgeYazimlari()).toEqual([]);
    degismedi();
  });

  it('sahip hesabı (belgesi var): bugünkü gibi açılır', async () => {
    durum.belge = { role: 'Admin' };
    const { container } = await ac(kullanici({ email: SAHIP }), '/dashboard');
    expect(kabukVar(container)).toBe(true);
    degismedi();
  });
});

// ═══ Kaynak çitleri: ölü kod kalmadı + «yazıldı ama bağlanmadı» bağı ════════════════════════════════════════════════════════
describe('App.tsx kaynağı — kayıt yolu SÖKÜLDÜ, kayıtsız hesap dalı bağlı', () => {
  const satirlar = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod);
  const kod = satirlar.join('\n');
  const say = (desen: RegExp) => satirlar.filter(s => desen.test(s)).length;

  it('kayıt yolunun hiçbir parçası yok: içe aktarım, durum, işleyici, sekme kümesi', () => {
    for (const yok of ['createUserWithEmailAndPassword', 'updateProfile', 'signupForm', 'handleEmailSignUp', "'signup'"]) expect(kod, yok).not.toContain(yok);
    expect(say(/useState<'signin'\|'reset'>\('signin'\)/)).toBe(1);
  });

  it('istemci yeni hesaba rol YAZMAZ: tek kurulum yazımı sahip dalında (`role = \'Admin\'`), «Sales» varsayılanı yok', () => {
    expect(say(/await setDoc\(userRef, /)).toBe(1);
    expect(say(/const role = 'Admin';/)).toBe(1);
    expect(kod).not.toMatch(/const role = .*'Sales'/);
  });

  // 2026-10-17 (şartname R — açılış turu): kayıtsız hesap dalı oturum dinleyicisinin içindeki `kayitsizHesap` bayrağından AYRI bir
  // işleve (`kayitsizHesabiKapat`) taşındı; çözüm denemesinin `'kayitsiz'` sonucu onu çağırır. Çit yeni bağı ölçer (bilerek değişti).
  it('kayıtsız hesap dalı bağlı: yenilik ölçütü, silme ve çıkış oturum dinleyicisinde çağrılıyor', () => {
    expect(say(/if \(hesapBuGiristeAcildi\(u, Date\.now\(\)\)\) \{/)).toBe(1);
    expect(say(/await deleteUser\(u\);/)).toBe(1);
    expect(say(/^\s*const kayitsizHesabiKapat = async \(u: User, davetHatasi: string \| null\): Promise<void> => \{$/)).toBe(1);
    expect(say(/^\s*if \(s\.tur === 'kayitsiz'\) \{ await kayitsizHesabiKapat\(u, s\.davetHatasi\); return; \}$/)).toBe(1);
    expect(say(/^\s*if \(!userSnap\.exists\(\)\) return \{ tur: 'kayitsiz', davetHatasi \};$/)).toBe(1);
  });
});
