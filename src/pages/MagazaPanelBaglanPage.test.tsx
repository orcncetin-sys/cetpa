// @vitest-environment jsdom
/**
 * MagazaPanelBaglanPage.test.tsx — mağaza paneli «ERP ile bağlan» onay sayfası (şartname v6 § 5.3, § 7 «İstemci — onay
 * sayfası»). Sayfanın güvenlik sözleşmesi: `yetki-kodu` isteği YALNIZ düğmenin tıklamasında gider.
 *
 * Uygulama düzeyi («oturumsuz → giriş sayfası», «oturumlu → onay», dört dokunuş) App.tsx çizilemediği için kaynak
 * sırasıyla kilitlenir: `MagazaPanelBaglanPage.baglama.degismez.test.ts`. Adresin yerinde kalması:
 * `src/hooks/useRouteSync.magazaPanelBaglan.test.tsx`.
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

import MagazaPanelBaglanPage from './MagazaPanelBaglanPage';

const MEYDAN = 'M'.repeat(43);
const TUR = 'T'.repeat(22);
const GECERLI = `#meydan=${MEYDAN}&tur=${TUR}`;
const DONUS = `https://www.cetpa.com.tr/panel.html#kod=${'K'.repeat(43)}&tur=${TUR}`;
const UC = '/api/magaza-panel/yetki-kodu';
const yanit = (kod: number, govde: unknown): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });
const replace = vi.fn();
const konum = { hash: '', replace };
const ac = (hash: string, dil: 'tr' | 'en' = 'tr', kim: { ad?: string; eposta?: string } = {}) => {
  konum.hash = hash;
  vi.stubGlobal('location', konum);
  return render(<MagazaPanelBaglanPage currentLanguage={dil} ad={kim.ad ?? 'Ayşe Yılmaz'} eposta={kim.eposta ?? 'ayse@ornek.com.tr'} />);
};
const dugme = (ad = 'Onayla ve bağlan'): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('button', { name: ad });

describe('Mağaza paneli onay sayfası (§ 5.3)', () => {
  beforeEach(() => { authFetch.mockReset(); replace.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('aynı görevde art arda iki tıklama (yeniden çizim araya girmeden) tek istek atar: `disabled` değil `mesgul` kilidi tutar', () => {
    authFetch.mockReturnValue(new Promise<Response>(() => {}));   // yanıt gelmez: kilit açılmaz
    ac(GECERLI);
    const onay = dugme();
    // Tek `act`: iki olay da React `disabled`ı işlemeden düşer (`fireEvent.click` × 2 ikinciyi kilitli düğmeye yollar).
    act(() => { onay.click(); onay.click(); });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(onay.disabled).toBe(true);
  });

  it('açılınca `yetki-kodu`na istek YOK; tıklamadan sonra tam 1 istek; başarıda `location.replace(donus)` ve dönüş adresi ekrana yazılmaz', async () => {
    authFetch.mockResolvedValue(yanit(200, { donus: DONUS }));
    ac(GECERLI);
    // Ekranda: kullanıcı adı + e-posta, sabit hedef, verilen yetki (kalem teslim + 8 saat) ve uyarı.
    expect(screen.getByText('Ayşe Yılmaz')).toBeTruthy();
    expect(screen.getByText('ayse@ornek.com.tr')).toBeTruthy();
    expect(screen.getByText('www.cetpa.com.tr mağaza paneli')).toBeTruthy();
    expect(screen.getByText(/kalem teslim işaretleme; 8 saat/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe('Bu isteği siz başlatmadıysanız onaylamayın.');
    // Yükleme + efektler bitti: istek yok.
    await act(async () => { await Promise.resolve(); });
    expect(authFetch).not.toHaveBeenCalled();

    // Düğme BİR kez yakalanır: ilk tıklamadan sonra adı «Bağlanıyor…» olur; aynı öğeye ikinci tıklama ikinci istek
    // (ikinci kod) üretmez.
    const onay = dugme();
    fireEvent.click(onay);
    fireEvent.click(onay);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(authFetch).toHaveBeenCalledTimes(1);
    const [yol, secenek] = authFetch.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(yol).toBe(UC);
    expect(secenek.method).toBe('POST');
    expect(secenek.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(secenek.body)).toEqual({ meydan: MEYDAN, tur: TUR });   // yalnız iki alan (sunucu şeması `.strict()`)
    expect(replace).toHaveBeenCalledWith(DONUS);
    // Dönüş adresi / kod ekrana (duruma) yazılmaz; yönlenirken düğme kilitli kalır.
    expect(document.body.textContent).not.toContain('K'.repeat(43));
    expect(document.body.innerHTML).not.toContain('panel.html');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Bağlanıyor…' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Bağlanıyor…' }));
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('parametreler İLK çizimde bir kez okunur: adres sonradan değişse de istek ilk çiftle gider', async () => {
    authFetch.mockResolvedValue(yanit(200, { donus: DONUS }));
    const { rerender } = ac(GECERLI);
    konum.hash = `#meydan=${'X'.repeat(43)}&tur=${'Y'.repeat(22)}`;
    rerender(<MagazaPanelBaglanPage currentLanguage="en" ad="Ayşe Yılmaz" eposta="ayse@ornek.com.tr" />);
    fireEvent.click(dugme('Approve and connect'));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(JSON.parse((authFetch.mock.calls[0] as [string, { body: string }])[1].body)).toEqual({ meydan: MEYDAN, tur: TUR });
  });

  it('bozuk / eksik parametrede düğme YOK ve istek YOK (iki dilde ayrı metin)', async () => {
    for (const [hash, dil, beklenen] of [
      [`#meydan=kisa&tur=${TUR}`, 'tr', /eksik ya da bozuk/],
      ['', 'tr', /eksik ya da bozuk/],
      [`#meydan=${MEYDAN}`, 'en', /missing or malformed/],
      [`#meydan=${MEYDAN}&tur=${TUR}&tur=${TUR}`, 'en', /missing or malformed/],
    ] as Array<[string, 'tr' | 'en', RegExp]>) {
      ac(hash, dil);
      expect(screen.queryByRole('button'), hash).toBeNull();
      expect(screen.getByRole('alert').textContent).toMatch(beklenen);
      await act(async () => { await Promise.resolve(); });
      cleanup();
    }
    expect(authFetch).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('MFA bekleyen (`403 mfaRequired`): doğrulama penceresini sayfa çizer; doğrulamadan sonra istek kendiliğinden YİNELENMEZ, kullanıcı yeniden basınca gider', async () => {
    authFetch.mockResolvedValueOnce(yanit(403, { error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true }));
    authFetch.mockResolvedValueOnce(yanit(200, { donus: DONUS }));
    ac(GECERLI);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(dugme());
    const pencere = await screen.findByRole('dialog');
    expect(pencere.getAttribute('data-dil')).toBe('tr');
    expect(screen.queryByText(/İki faktörlü doğrulama gerekli/)).toBeNull();   // sunucu metni basılmaz
    fireEvent.click(screen.getByRole('button', { name: 'mfa-tamam' }));
    expect((await screen.findByRole('status')).textContent).toBe('Doğrulama tamamlandı. Bağlanmak için düğmeye yeniden basın.');
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    // Kullanıcının İKİNCİ bilinçli tıklaması: ikinci istek ve yönlenme.
    fireEvent.click(dugme());
    await waitFor(() => expect(replace).toHaveBeenCalledWith(DONUS));
    expect(authFetch).toHaveBeenCalledTimes(2);
  });

  it('MFA penceresinden vazgeçilince sayfa başa döner: istek yinelenmez, düğme yerinde', async () => {
    authFetch.mockResolvedValue(yanit(403, { error: 'MFA verification required', mfaRequired: true }));
    ac(GECERLI, 'en');
    fireEvent.click(dugme('Approve and connect'));
    fireEvent.click(await screen.findByRole('button', { name: 'mfa-vazgec' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(dugme('Approve and connect').disabled).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('ret yanıtları AYRI metin basar (`kod` / `code` / durum kodundan tanınır); sunucunun `error` metni iki dilde de görünmez; yönlenme yok', async () => {
    const SUNUCU_METNI = 'Bu işlem için yetkiniz yok — SUNUCU-METNI-7Q';
    const durumlar: Array<[number, Record<string, unknown>, RegExp, RegExp]> = [
      [403, { ok: false, kod: 'rol', error: SUNUCU_METNI }, /bağlanma yetkisi yok/, /not allowed to connect/],
      [403, { ok: false, kod: 'kiraci', error: SUNUCU_METNI }, /şirkete ait değil/, /does not belong to the company/],
      [403, { code: 'COMPANY_SUSPENDED', error: SUNUCU_METNI }, /askıya alınmış/, /suspended/],
      [429, { ok: false, kod: 'sinir', error: SUNUCU_METNI }, /Çok fazla deneme/, /Too many attempts/],
      [503, { ok: false, kod: 'panel-yapilandirilmamis', error: SUNUCU_METNI }, /yapılandırılmamış/, /not configured/],
      [503, { ok: false, error: SUNUCU_METNI }, /şu an tamamlayamadı/, /could not complete the request/],
      [401, { error: SUNUCU_METNI }, /Oturumunuz geçerli değil/, /session is not valid/],
      [400, { ok: false, error: SUNUCU_METNI }, /şu an tamamlayamadı/, /could not complete the request/],
    ];
    for (const dil of ['tr', 'en'] as const) {
      const gorulen = new Set<string>();
      for (const [kod, govde, tr, en] of durumlar) {
        authFetch.mockReset();
        authFetch.mockResolvedValue(yanit(kod, govde));
        ac(GECERLI, dil);
        fireEvent.click(dugme(dil === 'tr' ? 'Onayla ve bağlan' : 'Approve and connect'));
        const uyari = await screen.findByRole('alert');
        expect(uyari.textContent, `${dil} ${kod} ${JSON.stringify(govde)}`).toMatch(dil === 'tr' ? tr : en);
        expect(document.body.textContent).not.toContain('SUNUCU-METNI-7Q');
        expect(document.body.textContent).not.toContain('yetkiniz yok —');
        // Ret sonrası düğme yeniden basılabilir (kilit açıldı).
        expect(dugme(dil === 'tr' ? 'Onayla ve bağlan' : 'Approve and connect').disabled).toBe(false);
        gorulen.add(uyari.textContent ?? '');
        cleanup();
      }
      // rol · kiracı · askıda · sınır · yapılandırma · okuma · oturum — yedi AYRI metin (400 ile gövdesiz 503 aynı «okuma»).
      expect(gorulen.size, dil).toBe(7);
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it('gövdesi JSON olmayan 429 «çok fazla deneme», gövdesiz 500 «tamamlayamadı»: yanıt okunamasa da sayfa çökmez', async () => {
    authFetch.mockResolvedValueOnce(new Response('<html>Too Many Requests</html>', { status: 429 }));
    ac(GECERLI);
    fireEvent.click(dugme());
    expect((await screen.findByRole('alert')).textContent).toMatch(/Çok fazla deneme/);
    cleanup();
    authFetch.mockResolvedValueOnce(new Response('', { status: 500 }));
    ac(GECERLI);
    fireEvent.click(dugme());
    expect((await screen.findByRole('alert')).textContent).toMatch(/şu an tamamlayamadı/);
  });

  it('ağ hatası (istek fırlatır): ayrı metin; düğme açılır ve yeni tıklama YENİ istek atar', async () => {
    authFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    authFetch.mockResolvedValueOnce(yanit(200, { donus: DONUS }));
    ac(GECERLI);
    fireEvent.click(dugme());
    expect((await screen.findByRole('alert')).textContent).toMatch(/Sunucuya ulaşılamadı/);
    expect(document.body.textContent).not.toContain('Failed to fetch');
    expect(authFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(dugme());
    await waitFor(() => expect(replace).toHaveBeenCalledWith(DONUS));
    expect(authFetch).toHaveBeenCalledTimes(2);
  });

  it('200 yanıtında dönüş adresi yoksa / `http(s)` değilse yönlenme YOK', async () => {
    for (const govde of [{}, { donus: '' }, { donus: 'javascript:alert(1)' }, { donus: 42 }, ['https://www.cetpa.com.tr/panel.html'], null]) {
      authFetch.mockReset();
      authFetch.mockResolvedValue(yanit(200, govde));
      ac(GECERLI);
      fireEvent.click(dugme());
      expect((await screen.findByRole('alert')).textContent, JSON.stringify(govde)).toMatch(/şu an tamamlayamadı/);
      cleanup();
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it('görünen ad yoksa e-posta tek satır; ikisi de yoksa «—» (düğme yine çizilir — rol / kimlik kapısı sunucuda)', () => {
    ac(GECERLI, 'tr', { ad: '', eposta: 'ayse@ornek.com.tr' });
    expect(screen.getAllByText('ayse@ornek.com.tr')).toHaveLength(1);
    cleanup();
    ac(GECERLI, 'tr', { ad: '', eposta: '' });
    expect(screen.getByText('—')).toBeTruthy();
    expect(dugme().disabled).toBe(false);
  });
});

describe('kaynak çitleri — MagazaPanelBaglanPage.tsx', () => {
  const satirlar = kodSatirlari(join(SRC_KOK, 'pages', 'MagazaPanelBaglanPage.tsx')).map(s => s.kod);
  const kod = satirlar.join('\n');

  it('`yetki-kodu` isteği TEK yerde ve yalnız tıklama işleyicisinde: dosyada efekt kancası YOK', () => {
    expect(kod).not.toMatch(/\buse(Layout|Insertion)?Effect\b|\buseMemo\b|\buseCallback\b|\buseSyncExternalStore\b|addEventListener|setTimeout|setInterval|queueMicrotask/);
    expect(kod.match(/\bauthFetch\(/g)).toHaveLength(1);
    expect(kod).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|authedFetch/);
    expect(kod.match(/'\/api\/magaza-panel\/yetki-kodu'/g)).toHaveLength(1);
    // İşleyici yalnız düğmenin `onClick`inden çağrılır.
    expect(kod.match(/\bonayla\(\)/g)).toHaveLength(1);
    expect(kod).toMatch(/onClick=\{\(\) => \{ void onayla\(\); \}\}/);
    // MFA dönüşü yalnız durumu değiştirir (isteği yinelemez).
    expect(kod).toContain("onSuccess={() => setDurum({ tur: 'mfa-tamam' })}");
    // Parametre yalnız ilk çizimde (tembel başlangıç değeri), adres parçası başka yerde okunmaz.
    expect(kod.match(/window\.location\.hash/g)).toHaveLength(1);
    expect(kod).toContain('useState<BaglanParametreleri | null>(() => baglanParametreleri(window.location.hash))');
  });

  it('dönüş adresi yalnız `location.replace`e gider: durum / günlük / depo yazımı yok; sunucunun `error` metni okunmaz; istemci rol kapısı yok', () => {
    expect(kod.match(/window\.location\.replace\(/g)).toHaveLength(1);
    expect(kod).not.toMatch(/location\.(href|assign)\b|window\.open\(/);
    expect(kod).not.toMatch(/\bconsole\.|localStorage|sessionStorage|document\.cookie|history\.(push|replace)State/);
    // `adres` (dönüş adresi) yalnız üç yerde: okuma, denetim, yönlenme.
    expect(satirlar.filter(s => /\badres\b/.test(s)).map(s => s.trim())).toEqual([
      'const adres = kayit(govde).donus;',
      'if (baglanDonusuGecerli(adres)) {',
      'window.location.replace(adres);',
    ]);
    expect(kod).not.toMatch(/\.error\b|\.message\b|\['error'\]/);
    expect(kod).not.toMatch(/userRole|magazaTalepIslemYetkisi|canAccess|rbac/);
    expect(kod).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error|toUpperCase|toLowerCase/);
  });
});
