// @vitest-environment jsdom
/**
 * MfaSifirlaDugmesi.test.tsx — Kullanıcılar ekranındaki «2FA'yı sıfırla» düğmesi (şartname «dış rol kapanışı» D10).
 *
 * NE ÖLÇÜLÜR: (1) kim görür — sunucu kapısıyla aynı kural; (2) istek YALNIZ onaydan sonra, doğru uca, doğru yöntemle gider;
 * (3) sonuç bildirimi sunucunun yanıtını yansıtır (sıfırlandı / kayıt yoktu / sunucu iletisi); (4) düğme Kullanıcılar ekranına
 * GERÇEKTEN bağlı (kaynak çiti — `AdminPage.tsx` çizilemeyecek kadar büyük) ve çağırdığı uç sunucuda kayıtlı.
 * Ucun kendisi gerçek zincirde: src/server/kucukKapanislar.zincir.test.ts (T9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { kodSatirlari, oku, SRC_KOK } from '../test/kaynakTarama';
import { STAFF_ROLES, EXTERNAL_ROLES } from '../lib/rbac';

const authFetch = vi.hoisted(() => vi.fn());
vi.mock('../services/authFetch', () => ({ authFetch }));

import MfaSifirlaDugmesi, { mfaSifirlaGorunur, mfaSifirlaYolu } from './MfaSifirlaDugmesi';

const yanit = (kod: number, govde: unknown): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });

type Onay = { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'default'; onConfirm: () => void };
const openConfirm = vi.fn<(o: Onay) => void>();
const toast = vi.fn<(msg: string, type?: string) => void>();

const ciz = (ek: Partial<Parameters<typeof MfaSifirlaDugmesi>[0]> = {}) => render(
  <MfaSifirlaDugmesi hedefUid="hedef-1" hedefAd="ayse@ornek.com.tr" cagiranUid="yonetici-1" cagiranRol="Admin" superAdmin={false}
    dil="tr" openConfirm={openConfirm} toast={toast} {...ek} />,
);
const dugme = (ad = '2FA\'yı sıfırla'): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('button', { name: ad });
/** Düğmeye basar ve onay penceresine verilen seçenekleri döner (pencerenin kendisi ekranın ortak aracıdır, burada çizilmez). */
const basVeOnayiAl = (): Onay => {
  act(() => { dugme().click(); });
  expect(openConfirm).toHaveBeenCalledTimes(1);
  return openConfirm.mock.calls[0][0];
};

beforeEach(() => { authFetch.mockReset(); openConfirm.mockReset(); toast.mockReset(); });
afterEach(() => { cleanup(); });

describe('mfaSifirlaGorunur — sunucu kapısıyla aynı kural', () => {
  const g = (ek: Partial<Parameters<typeof mfaSifirlaGorunur>[0]>) =>
    mfaSifirlaGorunur({ cagiranRol: 'Admin', superAdmin: false, cagiranUid: 'ben', hedefUid: 'o', ...ek });

  it('Yönetici başkasının satırında görür; KENDİ satırında görmez', () => {
    expect(g({})).toBe(true);
    expect(g({ hedefUid: 'ben' })).toBe(false);
  });

  it('Müdür ve diğer HER rol görmez (iç roller, dış roller, rolsüz, geçersiz değer)', () => {
    for (const rol of [...STAFF_ROLES, ...EXTERNAL_ROLES].filter(r => r !== 'Admin')) expect(g({ cagiranRol: rol }), rol).toBe(false);
    for (const rol of [null, undefined, '', 'admin', 'ADMIN', 'Yönetici']) expect(g({ cagiranRol: rol }), String(rol)).toBe(false);
  });

  it('süper yönetici rolü ne olursa olsun görür — ama kendi satırında o da görmez', () => {
    for (const rol of ['Manager', 'Sales', null, undefined]) expect(g({ cagiranRol: rol, superAdmin: true }), String(rol)).toBe(true);
    expect(g({ cagiranRol: 'Manager', superAdmin: true, hedefUid: 'ben' })).toBe(false);
  });

  it('kimlik bilinmiyorsa görünmez (oturum çözülmeden «kendi satırı mı» sorusu cevaplanamaz)', () => {
    expect(g({ cagiranUid: undefined })).toBe(false);
    expect(g({ cagiranUid: null })).toBe(false);
    expect(g({ hedefUid: '' })).toBe(false);
  });
});

describe('mfaSifirlaYolu', () => {
  it('kimlik yol parçası olarak kaçışlanır', () => {
    expect(mfaSifirlaYolu('abc123')).toBe('/api/admin/users/abc123/mfa-sifirla');
    expect(mfaSifirlaYolu('a/b?c')).toBe('/api/admin/users/a%2Fb%3Fc/mfa-sifirla');
  });
});

describe('düğme', () => {
  it('görmeyen çağıran için HİÇBİR şey çizilmez (Müdür, kendi satırı)', () => {
    expect(ciz({ cagiranRol: 'Manager' }).container.innerHTML).toBe('');
    cleanup();
    expect(ciz({ hedefUid: 'yonetici-1' }).container.innerHTML).toBe('');
  });

  it('tıklama istek ATMAZ: önce onay penceresi (tehlike türü, kullanıcının adıyla); istek yalnız onaydan sonra', async () => {
    ciz();
    const onay = basVeOnayiAl();
    expect(authFetch).not.toHaveBeenCalled();
    expect([onay.title, onay.confirmLabel, onay.variant]).toEqual(['İki faktörlü doğrulamayı (2FA) sıfırla', 'Sıfırla', 'danger']);
    expect(onay.message).toContain('ayse@ornek.com.tr');
    expect(onay.message).toContain('kodsuz girer');

    authFetch.mockResolvedValue(yanit(200, { success: true, kayitVardi: true }));
    await act(async () => { onay.onConfirm(); });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(authFetch.mock.calls).toEqual([['/api/admin/users/hedef-1/mfa-sifirla', { method: 'POST' }]]);
    expect(toast.mock.calls[0]).toEqual(['ayse@ornek.com.tr: iki faktörlü doğrulama sıfırlandı.', 'success']);
  });

  it('kayıt yoktu → bunu SÖYLER («sıfırlandı» demez)', async () => {
    ciz();
    const onay = basVeOnayiAl();
    authFetch.mockResolvedValue(yanit(200, { success: true, kayitVardi: false }));
    await act(async () => { onay.onConfirm(); });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]).toEqual(['ayse@ornek.com.tr: iki faktörlü doğrulama zaten kurulu değildi.', 'info']);
  });

  it('sunucu reddi: sunucunun iletisi gösterilir (403 Yönetici gerekli, 403 başka firma, 404, 503)', async () => {
    for (const [kod, ileti] of [
      [403, 'İki faktörlü doğrulamayı (2FA) yalnız Yönetici sıfırlayabilir.'],
      [403, 'Bu kullanıcı başka bir firmaya ait.'],
      [404, 'Kullanıcı kaydı bulunamadı.'],
      [503, 'İki faktörlü doğrulama bu kurulumda kullanılamıyor.'],
    ] as const) {
      authFetch.mockReset(); openConfirm.mockReset(); toast.mockReset();
      ciz();
      const onay = basVeOnayiAl();
      authFetch.mockResolvedValue(yanit(kod, { success: false, error: ileti }));
      await act(async () => { onay.onConfirm(); });
      await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
      expect(toast.mock.calls[0]).toEqual([ileti, 'error']);
      cleanup();
    }
  });

  it('iletisiz ret, JSON olmayan gövde ve ağ hatası → genel ileti; başarı DENMEZ', async () => {
    const durumlar: Array<() => void> = [
      () => authFetch.mockResolvedValue(yanit(500, {})),
      () => authFetch.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
      () => authFetch.mockResolvedValue(yanit(200, { success: false })),
      () => authFetch.mockRejectedValue(new Error('ağ yok')),
    ];
    for (const kur of durumlar) {
      authFetch.mockReset(); openConfirm.mockReset(); toast.mockReset();
      ciz();
      const onay = basVeOnayiAl();
      kur();
      await act(async () => { onay.onConfirm(); });
      await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
      expect(toast.mock.calls[0]).toEqual(['İki faktörlü doğrulama sıfırlanamadı.', 'error']);
      cleanup();
    }
  });

  it('istek sürerken düğme kilitli; bitince açılır', async () => {
    ciz();
    const onay = basVeOnayiAl();
    let coz: (r: Response) => void = () => {};
    authFetch.mockReturnValue(new Promise<Response>(r => { coz = r; }));
    await act(async () => { onay.onConfirm(); });
    expect(dugme().disabled).toBe(true);
    expect(dugme().getAttribute('aria-busy')).toBe('true');
    await act(async () => { coz(yanit(200, { success: true, kayitVardi: true })); });
    await waitFor(() => expect(dugme().disabled).toBe(false));
  });

  it('İngilizce arayüz: düğme, onay ve bildirim İngilizce', async () => {
    ciz({ dil: 'en' });
    act(() => { dugme('Reset 2FA').click(); });
    const onay = openConfirm.mock.calls[0][0];
    expect([onay.title, onay.confirmLabel]).toEqual(['Reset two-factor authentication (2FA)', 'Reset']);
    authFetch.mockResolvedValue(yanit(200, { success: true, kayitVardi: true }));
    await act(async () => { onay.onConfirm(); });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]).toEqual(['ayse@ornek.com.tr: two-factor authentication was reset.', 'success']);
  });
});

describe('bağlantı çiti — düğme Kullanıcılar ekranında, uç sunucuda (yazıldı ama bağlanmadı olmasın)', () => {
  const sayfa = kodSatirlari(join(SRC_KOK, 'pages', 'AdminPage.tsx'));
  const satirNo = (desen: RegExp): number[] => sayfa.filter(s => desen.test(s.kod)).map(s => s.n);

  it('AdminPage düğmeyi içe aktarır ve kullanıcı DETAY satırında, o satırın kullanıcısı + oturumun rolüyle çizer', () => {
    expect(satirNo(/^import MfaSifirlaDugmesi from '\.\.\/components\/MfaSifirlaDugmesi';$/)).toHaveLength(1);
    const cizim = satirNo(/<MfaSifirlaDugmesi$/);
    expect(cizim).toHaveLength(1);
    const blok = sayfa.filter(s => s.n > cizim[0] && s.n <= cizim[0] + 9).map(s => s.kod.trim());
    expect(blok).toEqual([
      'hedefUid={u.id as string}',
      'hedefAd={(u.email as string) || (u.displayName as string) || (u.id as string)}',
      'cagiranUid={user?.uid}',
      'cagiranRol={userRole}',
      'superAdmin={isSuperAdmin}',
      'dil={currentLanguage}',
      'openConfirm={openConfirm}',
      'toast={toast}',
      '/>',
    ]);
    // Detay satırının içinde: `…-detay` anahtarlı satır açıldıktan SONRA, kullanıcı listesinin boş hâlinden ÖNCE.
    const detay = satirNo(/<tr key=\{`\$\{u\.id\}-detay`\}/);
    expect(detay).toHaveLength(1);
    expect(cizim[0]).toBeGreaterThan(detay[0]);
    expect(cizim[0] - detay[0]).toBeLessThan(15);
  });

  it('çağrılan uç sunucuda kayıtlı (yol birebir) ve rota modülü `startServer`\'da bağlamıyla çağrılıyor', () => {
    const rotalar = oku(join(SRC_KOK, 'server', 'routes', 'epostaRoutes.ts'));
    expect(rotalar).toContain("app.post('/api/admin/users/:uid/mfa-sifirla', C.authLimiter, C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {");
    expect(mfaSifirlaYolu(':uid')).toBe('/api/admin/users/%3Auid/mfa-sifirla');   // yol kalıbı aynı; yer tutucu kaçışlanır
    const sunucu = oku(join(SRC_KOK, '..', 'server.ts'));
    expect(sunucu).toMatch(/getUserRole, isSuperAdmin, mfaSifirla: mfaKaydiniSil,/);
    expect(sunucu).toMatch(/^async function mfaKaydiniSil\(uid: string\): Promise<boolean \| null> \{$/m);
  });

  it('bileşen uca `authFetch` ile gider (çıplak `fetch` kimlik belirteci taşımaz)', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'components', 'MfaSifirlaDugmesi.tsx')).map(s => s.kod).join('\n');
    expect(kod).toMatch(/await authFetch\(mfaSifirlaYolu\(hedefUid\), \{ method: 'POST' \}\)/);
    expect(kod).not.toMatch(/(?<![A-Za-z])fetch\(/);
  });
});
