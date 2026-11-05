// @vitest-environment jsdom
/**
 * MagazaBayiBaglanPage.test.tsx — müşteri / bayi ekranı «ERP ile giriş» onay sayfası (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` H16). Sayfanın güvenlik sözleşmesi: açılışta YALNIZ firma okuma ucu; `yetki-kodu` isteği
 * YALNIZ düğmenin tıklamasında; ret metni sunucunun `kod`'undan, kendi sözlüğünden.
 *
 * Uygulama düzeyi (dış rol bu yolda kilit ekranı yerine bu sayfayı görür; iç rol uyarısı; oturumsuz → giriş; çıkış + yeniden giriş;
 * iki adımlı doğrulamanın `reload`'u) GERÇEK App ile `src/components/DisRolEkrani.uygulama.test.tsx`'te. Adresin yerinde kalması:
 * `src/hooks/useRouteSync.magazaPanelBaglan.test.tsx`. Kaynak sırası: `MagazaPanelBaglanPage.baglama.degismez.test.ts`.
 *
 * Mutasyonlar: `yetki-kodu` isteğini yüklenişe (efekte) taşı → «açılışta yalnız `GET hesap`» kırmızı; firma koşulunu düğmeden kaldır →
 * «okuma başarısızsa düğme yok» kırmızı.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';

const authFetch = vi.hoisted(() => vi.fn());
vi.mock('../services/authFetch', () => ({ authFetch }));
// Doğrulama penceresinin vekili: sayfanın verdiği üç niteliği dışarı açar (asıl pencere kendi isteğini atar).
vi.mock('../components/MfaSettings', async () => {
  const React = await import('react');
  return {
    MfaChallengeModal: (p: { currentLanguage: string; onSuccess: () => void; onCancel: () => void }) => React.createElement(
      'div', { role: 'dialog', 'data-dil': p.currentLanguage },
      React.createElement('button', { type: 'button', onClick: p.onSuccess }, 'mfa-tamam'),
      React.createElement('button', { type: 'button', onClick: p.onCancel }, 'mfa-vazgec'),
    ),
  };
});

import MagazaBayiBaglanPage from './MagazaBayiBaglanPage';

const MEYDAN = 'M'.repeat(43);
const TUR = 'T'.repeat(22);
const GECERLI = `#meydan=${MEYDAN}&tur=${TUR}`;
const DONUS = `https://www.cetpa.com.tr/bayi.html#kod=${'K'.repeat(43)}&tur=${TUR}`;
const HESAP = '/api/magaza-bayi/hesap';
const YETKI = '/api/magaza-bayi/yetki-kodu';
const FIRMA = 'Şirin Yapı Malzemeleri Ltd. Şti.';
const SUNUCU_METNI = 'SUNUCU-METNI-7Q yetkiniz yok';
const yanit = (kod: number, govde: unknown): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });
const replace = vi.fn();
const onCikis = vi.fn();
const konum = { hash: '', replace };

/** Yol başına yanıt kuyruğu; kuyruk biterse son yanıt kalıcıdır. Söz dönerse istek uçuşta kalır. */
let yanitlar: Record<string, Array<() => Response | Promise<Response>>> = {};
const sirala = (yol: string, ...y: Array<() => Response | Promise<Response>>) => { yanitlar[yol] = y; };
const cagrilar = (): Array<[string, string]> => authFetch.mock.calls.map(c => [((c[1] as { method?: string } | undefined)?.method ?? 'GET'), c[0] as string]);

const ac = (hash: string, dil: 'tr' | 'en' = 'tr', eposta = 'bayi@ornek.com.tr') => {
  konum.hash = hash;
  vi.stubGlobal('location', konum);
  return render(<MagazaBayiBaglanPage currentLanguage={dil} eposta={eposta} onCikis={onCikis} />);
};
const yuklen = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const dugme = (ad: string | RegExp = 'Onayla ve giriş yap'): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('button', { name: ad });
const onayDugmesi = (): HTMLButtonElement | null => screen.queryByRole<HTMLButtonElement>('button', { name: /Onayla ve giriş yap|Approve and sign in/ });

describe('Bayi ekranı onay sayfası (H16)', () => {
  beforeEach(() => {
    authFetch.mockReset(); replace.mockReset(); onCikis.mockReset();
    yanitlar = {};
    sirala(HESAP, () => yanit(200, { firma: FIRMA }));
    sirala(YETKI, () => yanit(200, { donus: DONUS }));
    authFetch.mockImplementation((yol: string) => {
      const kuyruk = yanitlar[yol] ?? [];
      const sonraki = kuyruk.length > 1 ? kuyruk.shift() : kuyruk[0];
      if (!sonraki) return Promise.resolve(yanit(404, {}));
      return Promise.resolve(sonraki());
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('açılışta YALNIZ `GET hesap` (tek kez); firma görünür; tıklamadan sonra tek `POST yetki-kodu` ve `location.replace(donus)`', async () => {
    ac(GECERLI);
    await yuklen();
    expect(cagrilar()).toEqual([['GET', HESAP]]);
    expect(screen.getByText(FIRMA)).toBeTruthy();
    expect(screen.getByText('bayi@ornek.com.tr')).toBeTruthy();
    expect(screen.getByText('www.cetpa.com.tr bayi ekranı')).toBeTruthy();
    expect(screen.getByText(/siparişlerini görme \(salt okuma\); 8 saat/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe('Bu isteği siz başlatmadıysanız onaylamayın.');
    const onay = dugme();
    fireEvent.click(onay);
    fireEvent.click(onay);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(cagrilar()).toEqual([['GET', HESAP], ['POST', YETKI]]);
    const [, secenek] = authFetch.mock.calls[1] as [string, { headers: Record<string, string>; body: string }];
    expect(secenek.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(secenek.body)).toEqual({ meydan: MEYDAN, tur: TUR });
    expect(replace).toHaveBeenCalledWith(DONUS);
    expect(document.body.textContent).not.toContain('K'.repeat(43));
    expect(dugme('Bağlanıyor…').disabled).toBe(true);
  });

  it('aynı görevde art arda iki tıklama tek istek atar (`mesgul` kilidi)', async () => {
    sirala(YETKI, () => new Promise<Response>(() => {}));
    ac(GECERLI);
    await yuklen();
    const onay = dugme();
    act(() => { onay.click(); onay.click(); });
    expect(cagrilar().filter(([, y]) => y === YETKI)).toHaveLength(1);
  });

  it('firma okunamazsa ya da gelmezse onay düğmesi ÇİZİLMEZ ve `yetki-kodu` hiç istenmez; her ret kendi metniyle', async () => {
    const durumlar: Array<[string, () => Response | Promise<Response>, RegExp, boolean]> = [
      ['bağ yok', () => yanit(403, { ok: false, kod: 'bag-yok', error: SUNUCU_METNI }), /Hesabınız bir firmaya bağlı değil ya da erişiminiz kapalı — Cetpa ile görüşün/, false],
      ['kapalı', () => yanit(403, { ok: false, kod: 'kapali', error: SUNUCU_METNI }), /Hesabınız bir firmaya bağlı değil ya da erişiminiz kapalı — Cetpa ile görüşün/, false],
      ['iç rol', () => yanit(403, { ok: false, kod: 'rol', error: SUNUCU_METNI }), /^Bu bağlantı yalnız müşteri hesapları içindir\.$/, false],
      ['rolsüz', () => yanit(403, { error: SUNUCU_METNI, code: 'ROL_YOK' }), /^Bu bağlantı yalnız müşteri hesapları içindir\.$/, false],
      ['Google girişi', () => yanit(403, { ok: false, kod: 'sifre-gerekli' }), /çıkış yapıp e-posta ve şifrenizle yeniden girin/, true],
      ['12 saat', () => yanit(401, { ok: false, kod: 'yeniden-giris' }), /çıkış yapıp e-posta ve şifrenizle yeniden girin/, true],
      ['denetlenemedi', () => yanit(503, { ok: false, kod: 'denetlenemedi' }), /Şu an doğrulanamadı, biraz sonra yeniden deneyin/, false],
      ['okuma 503', () => yanit(503, { ok: false }), /şu an tamamlayamadı/, false],
      // Sunucu bayi yapılandırılmamışken firma okumasında da bunu döner (magazaErpRoutes `bayiHesap`): düğme hiç çizilmez.
      ['yapılandırılmamış', () => yanit(503, { ok: false, kod: 'bayi-yapilandirilmamis' }), /^Bayi ekranı bağlantısı sunucuda henüz yapılandırılmamış — Cetpa ile görüşün\.$/, false],
      ['ağ', () => Promise.reject(new TypeError('Failed to fetch')), /Sunucuya ulaşılamadı/, false],
      ['firma boş', () => yanit(200, { firma: '  ' }), /firma bilgisi eksik/, false],
      ['firma yok', () => yanit(200, {}), /firma bilgisi eksik/, false],
    ];
    for (const [ad, y, metin, cikisVar] of durumlar) {
      authFetch.mockClear();
      sirala(HESAP, y);
      ac(GECERLI);
      await yuklen();
      expect(onayDugmesi(), ad).toBeNull();
      expect(screen.getByRole('alert').textContent, ad).toMatch(metin);
      expect(screen.queryByRole('button', { name: 'Çıkış yap' }) !== null, ad).toBe(cikisVar);
      expect(document.body.textContent, ad).not.toContain('SUNUCU-METNI-7Q');
      expect(cagrilar(), ad).toEqual([['GET', HESAP]]);
      cleanup();
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it('tıklamadaki retler `kod`dan tanınır (iki dilde); sunucu metni görünmez; yeniden giriş retlerinde «Çıkış yap» VAR ve «Bir süre sonra yeniden deneyin» YOK', async () => {
    const durumlar: Array<[number, Record<string, unknown>, RegExp, RegExp, boolean]> = [
      [401, { ok: false, kod: 'yeniden-giris' }, /Güvenlik için çıkış yapıp e-posta ve şifrenizle yeniden girin\. Şifreniz yoksa giriş ekranındaki «Şifremi Unuttum» ile oluşturun\./, /sign out and sign in again with your email and password/, true],
      [403, { ok: false, kod: 'sifre-gerekli' }, /Güvenlik için çıkış yapıp e-posta ve şifrenizle yeniden girin/, /sign out and sign in again with your email and password/, true],
      [401, { error: SUNUCU_METNI }, /Oturumunuz geçerli değil/, /session is not valid/, true],
      [403, { ok: false, kod: 'rol', error: SUNUCU_METNI }, /yalnız müşteri hesapları içindir/, /customer accounts only/, false],
      [403, { ok: false, kod: 'bag-yok' }, /bir firmaya bağlı değil ya da erişiminiz kapalı/, /not linked to a company or your access is closed/, false],
      [403, { ok: false, kod: 'kapali' }, /bir firmaya bağlı değil ya da erişiminiz kapalı/, /not linked to a company or your access is closed/, false],
      [403, { ok: false, kod: 'kiraci' }, /şirkete ait değil ya da şirket hesabı askıda/, /does not belong to the company/, false],
      [503, { ok: false, kod: 'denetlenemedi' }, /Şu an doğrulanamadı, biraz sonra yeniden deneyin/, /Could not be verified right now/, false],
      [429, { ok: false, kod: 'sinir' }, /Çok fazla deneme/, /Too many attempts/, false],
      [503, { ok: false, kod: 'bayi-yapilandirilmamis' }, /yapılandırılmamış/, /not configured/, false],
      [503, { ok: false }, /şu an tamamlayamadı/, /could not complete the request/, false],
    ];
    for (const dil of ['tr', 'en'] as const) {
      const cikisAdi = dil === 'tr' ? 'Çıkış yap' : 'Sign out';
      const onayAdi = dil === 'tr' ? 'Onayla ve giriş yap' : 'Approve and sign in';
      for (const [kod, govde, tr, en, cikisVar] of durumlar) {
        sirala(YETKI, () => yanit(kod, govde));
        ac(GECERLI, dil);
        await yuklen();
        fireEvent.click(dugme(onayAdi));
        const uyari = await screen.findByRole('alert');
        const ad = `${dil} ${kod} ${JSON.stringify(govde)}`;
        expect(uyari.textContent, ad).toMatch(dil === 'tr' ? tr : en);
        expect(screen.queryByRole('button', { name: cikisAdi }) !== null, ad).toBe(cikisVar);
        if (cikisVar) expect(document.body.textContent, ad).not.toMatch(/Bir süre sonra yeniden deneyin|Try again in a while/);
        expect(document.body.textContent, ad).not.toContain('SUNUCU-METNI-7Q');
        expect(dugme(onayAdi).disabled, ad).toBe(false);   // kilit açıldı: yeniden basılabilir
        cleanup();
      }
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it('«Çıkış yap» App\'in çıkış işleyicisini BİR kez çağırır (sürerken pasif); sayfa kendisi yeniden doğrulama yapmaz', async () => {
    let bitir: () => void = () => {};
    onCikis.mockImplementation(() => new Promise<void>((r) => { bitir = r; }));
    sirala(YETKI, () => yanit(401, { ok: false, kod: 'yeniden-giris' }));
    ac(GECERLI);
    await yuklen();
    fireEvent.click(dugme());
    const cikis = await screen.findByRole<HTMLButtonElement>('button', { name: 'Çıkış yap' });
    fireEvent.click(cikis);
    fireEvent.click(cikis);
    expect(onCikis).toHaveBeenCalledTimes(1);
    expect(cikis.disabled).toBe(true);
    await act(async () => { bitir(); await Promise.resolve(); });
    expect(cagrilar()).toEqual([['GET', HESAP], ['POST', YETKI]]);
  });

  it('bozuk / eksik parametrede onay düğmesi YOK ve `yetki-kodu` istenmez (iki dil)', async () => {
    for (const [hash, dil, beklenen] of [
      [`#meydan=kisa&tur=${TUR}`, 'tr', /eksik ya da bozuk/],
      ['', 'tr', /eksik ya da bozuk/],
      [`#meydan=${MEYDAN}&tur=${TUR}&tur=${TUR}`, 'en', /missing or malformed/],
    ] as Array<[string, 'tr' | 'en', RegExp]>) {
      ac(hash, dil);
      await yuklen();
      expect(onayDugmesi(), hash).toBeNull();
      expect(screen.getByRole('alert').textContent).toMatch(beklenen);
      cleanup();
    }
    expect(cagrilar().filter(([, y]) => y === YETKI)).toEqual([]);
  });

  it('parametreler İLK çizimde bir kez okunur: adres sonradan değişse de istek ilk çiftle gider', async () => {
    const { rerender } = ac(GECERLI);
    await yuklen();
    konum.hash = `#meydan=${'X'.repeat(43)}&tur=${'Y'.repeat(22)}`;
    rerender(<MagazaBayiBaglanPage currentLanguage="en" eposta="bayi@ornek.com.tr" onCikis={onCikis} />);
    fireEvent.click(dugme('Approve and sign in'));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(JSON.parse((authFetch.mock.calls[1] as [string, { body: string }])[1].body)).toEqual({ meydan: MEYDAN, tur: TUR });
    expect(cagrilar().filter(([, y]) => y === HESAP)).toHaveLength(1);   // dil değişimi yeniden okutmaz
  });

  it('200 yanıtında dönüş adresi yoksa / `http(s)` değilse yönlenme YOK (ortak `baglanDonusuGecerli`)', async () => {
    for (const govde of [{}, { donus: '' }, { donus: 'javascript:alert(1)' }, { donus: 42 }, null]) {
      sirala(YETKI, () => yanit(200, govde));
      ac(GECERLI);
      await yuklen();
      fireEvent.click(dugme());
      expect((await screen.findByRole('alert')).textContent, JSON.stringify(govde)).toMatch(/şu an tamamlayamadı/);
      cleanup();
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it('firma okuması `403 mfaRequired`: doğrulama penceresi; doğrulanınca firma YENİDEN okunur (kod istenmez); vazgeçilince çıkış önerilir', async () => {
    sirala(HESAP, () => yanit(403, { error: 'MFA', mfaRequired: true }), () => yanit(200, { firma: FIRMA }));
    ac(GECERLI);
    await yuklen();
    expect(screen.getByRole('dialog').getAttribute('data-dil')).toBe('tr');
    expect(onayDugmesi()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'mfa-tamam' }));
    await yuklen();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(FIRMA)).toBeTruthy();
    expect(cagrilar()).toEqual([['GET', HESAP], ['GET', HESAP]]);
    cleanup();
    authFetch.mockClear();
    sirala(HESAP, () => yanit(403, { error: 'MFA', mfaRequired: true }));
    ac(GECERLI);
    await yuklen();
    fireEvent.click(screen.getByRole('button', { name: 'mfa-vazgec' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Çıkış yap' })).toBeTruthy();
    expect(cagrilar()).toEqual([['GET', HESAP]]);
  });

  it('tıklamada `403 mfaRequired`: pencere; doğrulamadan sonra istek kendiliğinden YİNELENMEZ, kullanıcı yeniden basınca gider', async () => {
    sirala(YETKI, () => yanit(403, { error: 'MFA', mfaRequired: true }), () => yanit(200, { donus: DONUS }));
    ac(GECERLI);
    await yuklen();
    fireEvent.click(dugme());
    fireEvent.click(await screen.findByRole('button', { name: 'mfa-tamam' }));
    expect((await screen.findByRole('status')).textContent).toBe('Doğrulama tamamlandı. Giriş için düğmeye yeniden basın.');
    await yuklen();
    expect(cagrilar()).toEqual([['GET', HESAP], ['POST', YETKI]]);
    fireEvent.click(dugme());
    await waitFor(() => expect(replace).toHaveBeenCalledWith(DONUS));
    expect(cagrilar()).toEqual([['GET', HESAP], ['POST', YETKI], ['POST', YETKI]]);
  });

  it('geçici okuma retinde «Yeniden dene» firmayı yeniden okur; kalıcı retlerde (bağ yok, iç rol) düğme yok', async () => {
    sirala(HESAP, () => yanit(503, { ok: false, kod: 'denetlenemedi' }), () => yanit(200, { firma: FIRMA }));
    ac(GECERLI);
    await yuklen();
    fireEvent.click(dugme('Yeniden dene'));
    await yuklen();
    expect(screen.getByText(FIRMA)).toBeTruthy();
    expect(onayDugmesi()).not.toBeNull();
    expect(cagrilar()).toEqual([['GET', HESAP], ['GET', HESAP]]);
    cleanup();
    for (const govde of [{ kod: 'bag-yok' }, { kod: 'rol' }]) {
      sirala(HESAP, () => yanit(403, govde));
      ac(GECERLI);
      await yuklen();
      expect(screen.queryByRole('button', { name: 'Yeniden dene' }), JSON.stringify(govde)).toBeNull();
      cleanup();
    }
  });
});

describe('kaynak çitleri — MagazaBayiBaglanPage.tsx', () => {
  const satirlar = kodSatirlari(join(SRC_KOK, 'pages', 'MagazaBayiBaglanPage.tsx')).map(s => s.kod);
  const kod = satirlar.join('\n');

  it('açılışta TEK efekt ve o efekt yalnız firma okur; `yetki-kodu` dizgisi TAM bir kez ve yalnız `onayla()` gövdesinde', () => {
    expect(kod.match(/\buseEffect\(/g)).toHaveLength(1);
    expect(kod).not.toMatch(/\buse(Layout|Insertion)Effect\b|\buseSyncExternalStore\b|addEventListener|setTimeout|setInterval|queueMicrotask/);
    expect(kod.match(/\bauthFetch\(/g)).toHaveLength(2);
    expect(kod).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|authedFetch/);
    const yetki = satirlar.map((s, i) => [s, i] as const).filter(([s]) => s.includes("'/api/magaza-bayi/yetki-kodu'")).map(([, i]) => i);
    expect(yetki).toHaveLength(1);
    const bas = satirlar.findIndex(s => /^\s*const onayla = async \(\): Promise<void> => \{$/.test(s));
    const son = satirlar.findIndex((s, i) => i > bas && /^ {2}\};$/.test(s));
    expect(bas).toBeGreaterThan(-1);
    expect(yetki[0]).toBeGreaterThan(bas);
    expect(yetki[0]).toBeLessThan(son);
    // Efekt gövdesi `yetki-kodu`yu ÇAĞIRMAZ (`onayla` efektte geçmez) ve tek okuma ucunu kullanır.
    const efektBas = satirlar.findIndex(s => /^\s*useEffect\(\(\) => \{$/.test(s));
    const efektSon = satirlar.findIndex((s, i) => i > efektBas && /^ {2}\}, \[okumaNo\]\);$/.test(s));
    const efekt = satirlar.slice(efektBas, efektSon + 1).join('\n');
    expect(efekt).toContain('authFetch(HESAP_UCU)');
    expect(efekt).not.toMatch(/onayla|yetki-kodu|YETKI/);
    expect(kod).toContain("const HESAP_UCU = '/api/magaza-bayi/hesap';");
    // İşleyici yalnız düğmenin `onClick`inden çağrılır.
    expect(kod.match(/\bonayla\(\)/g)).toHaveLength(1);
    expect(kod).toMatch(/onClick=\{\(\) => \{ void onayla\(\); \}\}/);
    // MFA dönüşü isteği yinelemez (durumu değiştirir; firma okumasını yeniden başlatabilir).
    expect(kod).toContain("setIslem(i => (i.tur === 'mfa' ? { tur: 'mfa-tamam' } : i));");
  });

  it('parametre ve dönüş doğrulaması panelle ORTAK işlevden (kopya yok); adres parçası yalnız ilk çizimde okunur', () => {
    expect(kod).toContain("import { baglanDonusuGecerli, baglanParametreleri, type BaglanParametreleri } from '../lib/magazaPanelBaglan';");
    expect(kod.match(/window\.location\.hash/g)).toHaveLength(1);
    expect(kod).toContain('useState<BaglanParametreleri | null>(() => baglanParametreleri(window.location.hash))');
    expect(kod).not.toMatch(/new URL\(|MAGAZA_PANEL_43_DESENI|MAGAZA_PANEL_TUR_DESENI|split\('&'\)/);
  });

  it('dönüş adresi yalnız `location.replace`e gider; sunucunun `error` metni okunmaz; istemci rol kapısı yok; yasaklı kalıplar yok', () => {
    expect(kod.match(/window\.location\.replace\(/g)).toHaveLength(1);
    expect(kod).not.toMatch(/location\.(href|assign)\b|window\.open\(/);
    expect(kod).not.toMatch(/\bconsole\.|localStorage|sessionStorage|document\.cookie|history\.(push|replace)State/);
    expect(satirlar.filter(s => /\badres\b/.test(s)).map(s => s.trim())).toEqual([
      'const adres = kayit(govde).donus;',
      'if (baglanDonusuGecerli(adres)) {',
      'window.location.replace(adres);',
    ]);
    expect(kod).not.toMatch(/\.error\b|\.message\b|\['error'\]/);
    expect(kod).not.toMatch(/userRole|disRolMu|EXTERNAL_ROLES|canAccess|rbac/);
    expect(kod).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error|toUpperCase|toLowerCase/);
  });
});
