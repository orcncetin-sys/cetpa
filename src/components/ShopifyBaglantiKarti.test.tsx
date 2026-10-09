/**
 * ShopifyBaglantiKarti.test.tsx — Ayarlar → Entegrasyonlar'daki Shopify bağlantı kartı (şartname online-siparis-2026-10-02 §4 + v2).
 * Kart GERÇEKTEN çizilir; yalnız ağ (`authFetch`), onay penceresi ve bildirim balonu sahtedir.
 *
 * Korunan değişmezler:
 *  (a) imza sırrı alanı kayıtlı değere bağlanmaz — sunucu sırrı YANLIŞLIKLA döndürse bile ekrana/DOM'a girmez;
 *  (b) Admin dışı rol (Manager) düzenleyemez: alan ve düğme yok; süper-admin rolü ne olursa olsun düzenler;
 *  (c) hiç bildirim alınmamışken "Bağlı" rozeti YOK (sahte kesinlik);
 *  (c2) imzası tutmayan bildirim "henüz bildirim alınmadı"dan AYIRT edilir; ret satırı rozeti değiştirmez;
 *  (d) Kaydet doğru gövdeyle POST atar; boş sır gövdeye girmez; başarıdan sonra sır alanı temizlenir;
 *  (e) sunucunun hata metni (409) kullanıcıya gösterilir;
 *  (f) durum okunamazsa (403 / ağ hatası / JSON olmayan yanıt) kart çökmez;
 *  (g) kart Ayarlar sayfasına GERÇEKTEN bağlı ve sayfada eski `shopify_*` alanları / "Senkronize et" kalmadı (kaynak taraması).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ShopifyBaglantiKarti from './ShopifyBaglantiKarti';
import { tarihSaatYaz } from '../utils/zaman';

const authFetch = vi.fn();
const confirmAction = vi.fn();
const toast = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../lib/confirm', () => ({ confirmAction: (...a: unknown[]) => confirmAction(...a) }));
vi.mock('./Toast', () => ({ useToast: () => toast }));

const yanit = (status: number, govde: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(govde) });

const SIR = 'shpss_ISTEMCIYE_DONMEMELI_0123456789';
const YOL = '/api/shopify/webhook';
const ADRES = 'https://app.cetpa.com.tr/api/shopify/webhook';

const bos = { success: true, configured: false, shopDomain: null, webhookSirriKayitli: false, webhookAdresi: ADRES, webhookYolu: YOL, durum: null };
const kayitliBildirimsiz = { ...bos, configured: true, shopDomain: 'cetpa.myshopify.com', webhookSirriKayitli: true };
const durumDolu = {
  sonBildirim: '2026-10-02T09:34:00.000Z', sonTopic: 'orders/create', sonSiparisNo: '#1042', sonSonuc: 'olusturuldu',
  sonHata: null, sonHataZamani: null, sonApiSurumu: '2026-07', toplamBildirim: 1234,
};
const kayitliBildirimli = { ...kayitliBildirimsiz, durum: durumDolu };

type Istek = { url: string; method: string; govde: unknown };
/** `authFetch` çağrılarını (url, yöntem, çözülmüş gövde) olarak verir. */
const istekler = (): Istek[] => authFetch.mock.calls.map(c => {
  const init = c[1] as { method?: string; body?: string } | undefined;
  return { url: String(c[0]), method: init?.method ?? 'GET', govde: init?.body === undefined ? undefined : JSON.parse(init.body) };
});
const yazmaIstekleri = () => istekler().filter(i => i.method !== 'GET');

/** GET'e `get` yanıtını, POST'lara `post` işlevinin döndürdüğünü verir. */
function yonlendir(get: unknown, post?: (url: string) => unknown) {
  authFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === 'GET') return get;
    return post ? post(url) : yanit(500, { success: false, error: `beklenmeyen istek ${url}` });
  });
}

const ciz = (rol = 'Admin', dil: 'tr' | 'en' = 'tr', superYonetici = false) =>
  render(<ShopifyBaglantiKarti currentLanguage={dil} userRole={rol} superYonetici={superYonetici} />);
const sirAlani = () => screen.getByLabelText('İmza sırrı') as HTMLInputElement;
const alanAdiAlani = () => screen.getByLabelText('Mağaza alan adı') as HTMLInputElement;
const kaydetDugmesi = () => screen.getByRole('button', { name: 'Kaydet' });

beforeEach(() => { authFetch.mockReset(); confirmAction.mockReset(); toast.mockReset(); });

describe('ShopifyBaglantiKarti — (a) imza sırrı kayıtlı değere bağlanmaz', () => {
  it('sır kayıtlıyken alan BOŞ, "Kayıtlı ✓" rozeti GET\'ten; yanıtta sızan sır DOM\'a girmez', async () => {
    // Sözleşmeye göre yanıtta sır alanı YOK. Burada bilerek sızdırılıyor: kart yine de onu hiçbir yere koymamalı.
    yonlendir(yanit(200, { ...kayitliBildirimli, webhookSecret: SIR, sir: SIR, durum: { ...durumDolu, webhookSecret: SIR } }));
    const { container } = ciz();
    const alan = await screen.findByLabelText('İmza sırrı') as HTMLInputElement;
    expect(alan.value).toBe('');
    expect(alan.getAttribute('value') ?? '').toBe('');
    expect(alan.type).toBe('password');
    expect(alan.getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByText('Kayıtlı ✓')).toBeTruthy();
    expect(screen.getByText(/Boş bırakırsan mevcut sır korunur/)).toBeTruthy();
    expect(container.innerHTML).not.toContain(SIR);
    for (const girdi of Array.from(container.querySelectorAll('input'))) expect(girdi.value).not.toContain(SIR);
    // Alan adı sır değildir: forma geri okunur.
    expect(alanAdiAlani().value).toBe('cetpa.myshopify.com');
  });

  it('sır kayıtlı DEĞİLKEN rozet yok, not "ilk kurulumda zorunlu" der', async () => {
    yonlendir(yanit(200, bos));
    ciz();
    expect((await screen.findByLabelText('İmza sırrı') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Kayıtlı ✓')).toBeNull();
    expect(screen.getByText(/İlk kurulumda zorunlu/)).toBeTruthy();
  });
});

describe('ShopifyBaglantiKarti — (b) yalnız Admin düzenler', () => {
  it('Manager: durum görünür; giriş alanı, Kaydet ve Bağlantıyı kaldır YOK; neden yazılı', async () => {
    yonlendir(yanit(200, kayitliBildirimli));
    const { container } = ciz('Manager');
    expect(await screen.findByText(/yalnız Yönetici \(Admin\) rolü düzenleyebilir/)).toBeTruthy();
    expect(screen.getByText('cetpa.myshopify.com')).toBeTruthy();   // durum salt okunur metin olarak
    expect(screen.getByText('#1042')).toBeTruthy();
    expect(screen.getByText('Kayıtlı ✓')).toBeTruthy();
    expect(container.querySelectorAll('input, textarea, select').length).toBe(0);
    expect(screen.queryByRole('button', { name: 'Kaydet' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Bağlantıyı kaldır/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Kopyala/ })).toBeNull();
    expect(yazmaIstekleri()).toEqual([]);
  });

  it('Admin: aynı yanıtla alanlar ve düğmeler VAR (ayırt edici karşı örnek)', async () => {
    yonlendir(yanit(200, kayitliBildirimli));
    ciz('Admin');
    await screen.findByLabelText('İmza sırrı');
    expect(kaydetDugmesi()).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bağlantıyı kaldır/ })).toBeTruthy();
    expect((screen.getByLabelText('Webhook adresi') as HTMLInputElement).value).toBe(ADRES);
    expect(screen.queryByText(/yalnız Yönetici \(Admin\) rolü düzenleyebilir/)).toBeNull();
  });

  it('süper-admin: rolü Manager olsa da alanlar ve düğmeler VAR (sunucu kapısı `yalnizYonetici` ona izin veriyor)', async () => {
    // Mutasyon-ayırt-edici: `duzenleyebilir`den `|| superYonetici` silinirse bu vaka kırılır; aynı rol + bayraksız
    // çizim (yukarıdaki Manager vakası) formu GÖSTERMEZ — fark yalnız bayraktan gelir.
    yonlendir(yanit(200, kayitliBildirimli), () => yanit(200, kayitliBildirimli));
    ciz('Manager', 'tr', true);
    expect((await screen.findByLabelText('İmza sırrı') as HTMLInputElement).value).toBe('');
    expect(alanAdiAlani().value).toBe('cetpa.myshopify.com');
    expect(kaydetDugmesi()).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bağlantıyı kaldır/ })).toBeTruthy();
    expect((screen.getByLabelText('Webhook adresi') as HTMLInputElement).value).toBe(ADRES);
    expect(screen.queryByText(/yalnız Yönetici \(Admin\) rolü düzenleyebilir/)).toBeNull();
    // Düğme yalnız çizilmiş değil, ÇALIŞIYOR: `kaydet` içindeki `!duzenleyebilir` kapısı da süper-admini geçirir.
    fireEvent.click(kaydetDugmesi());
    await waitFor(() => expect(yazmaIstekleri()).toEqual([{ url: '/api/shopify/baglanti', method: 'POST', govde: { shopDomain: 'cetpa.myshopify.com' } }]));
  });

  it('süper-admin bayrağı YANLIŞKEN Sales rolü de düzenleyemez (varsayılan kapalı)', async () => {
    yonlendir(yanit(200, kayitliBildirimli));
    const { container } = ciz('Sales', 'tr', false);
    expect(await screen.findByText(/yalnız Yönetici \(Admin\) rolü düzenleyebilir/)).toBeTruthy();
    expect(container.querySelectorAll('input').length).toBe(0);
    expect(screen.queryByRole('button', { name: 'Kaydet' })).toBeNull();
  });
});

describe('ShopifyBaglantiKarti — (c) sahte kesinlik yok: rozet yalnız bildirim alındıysa "Bağlı"', () => {
  it('kayıt var, durum yok → "Bağlı" YOK; "Doğrulanmadı" + açık not', async () => {
    yonlendir(yanit(200, kayitliBildirimsiz));
    ciz();
    expect(await screen.findByText('Henüz bildirim alınmadı — bağlantı doğrulanmadı.')).toBeTruthy();
    expect(screen.getByText('Doğrulanmadı')).toBeTruthy();
    expect(screen.queryByText('Bağlı')).toBeNull();
    expect(screen.queryByText('Son bildirim')).toBeNull();
  });

  it('durum dokümanı var ama içi boş (hiç bildirim yok) → yine "Bağlı" YOK; toplam 0 "bildirim alındı" sayılmaz', async () => {
    yonlendir(yanit(200, { ...kayitliBildirimsiz, durum: { ...durumDolu, sonBildirim: null, sonTopic: null, sonSiparisNo: null, sonSonuc: null, sonApiSurumu: null, toplamBildirim: 0 } }));
    ciz();
    expect(await screen.findByText('Doğrulanmadı')).toBeTruthy();
    expect(screen.queryByText('Bağlı')).toBeNull();
  });

  it('bağlantı kurulmamış → "Bağlı Değil"; "Bağlı" ve "Doğrulanmadı" yok', async () => {
    yonlendir(yanit(200, bos));
    ciz();
    expect(await screen.findByText('Bağlı Değil')).toBeTruthy();
    expect(screen.queryByText('Bağlı')).toBeNull();
    expect(screen.queryByText('Doğrulanmadı')).toBeNull();
    expect(screen.queryByText(/Henüz bildirim alınmadı/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Bağlantıyı kaldır/ })).toBeNull();   // kaldıracak kayıt yok
  });

  it('bildirim alınmış → "Bağlı"; son bildirim zamanı, olay türü, sipariş no, toplam', async () => {
    yonlendir(yanit(200, kayitliBildirimli));
    ciz();
    expect(await screen.findByText('Bağlı')).toBeTruthy();
    expect(screen.queryByText('Doğrulanmadı')).toBeNull();
    expect(screen.queryByText(/Henüz bildirim alınmadı/)).toBeNull();
    expect(screen.getByText(tarihSaatYaz(durumDolu.sonBildirim))).toBeTruthy();
    expect(screen.getByText('orders/create')).toBeTruthy();
    expect(screen.getByText(/Sipariş oluşturuldu/)).toBeTruthy();
    expect(screen.getByText('#1042')).toBeTruthy();
    expect(screen.getByText('1.234')).toBeTruthy();
    expect(screen.getByText('2026-07')).toBeTruthy();
  });

  it('toplam bildirim bilinmiyorsa "—" basılır (0 uydurulmaz); son hata zamanıyla belirgin uyarıdır', async () => {
    const hataZamani = '2026-10-02T10:05:00.000Z';
    yonlendir(yanit(200, { ...kayitliBildirimli, durum: { ...durumDolu, toplamBildirim: null, sonSonuc: 'hata', sonHata: 'Sipariş yazılamadı: kiracı bulunamadı', sonHataZamani: hataZamani } }));
    ciz();
    const uyari = (await screen.findByText('Sipariş yazılamadı: kiracı bulunamadı')).closest('[role="alert"]');
    if (!(uyari instanceof HTMLElement)) throw new Error('son hata uyarısı yok');
    expect(uyari.textContent).toContain('Son hata');
    expect(uyari.textContent).toContain(tarihSaatYaz(hataZamani));
    const toplam = screen.getByText('Toplam bildirim').parentElement;
    expect(toplam?.textContent).toBe('Toplam bildirim—');
  });

  it('webhookAdresi null → adres tarayıcı kökü + webhookYolu ile kurulur', async () => {
    yonlendir(yanit(200, { ...bos, webhookAdresi: null }));
    ciz();
    expect((await screen.findByLabelText('Webhook adresi') as HTMLInputElement).value).toBe(`${window.location.origin}${YOL}`);
  });

  it('Kopyala: pano yoksa çökmez, adres seçilebilir kalır ve bunu söyler', async () => {
    yonlendir(yanit(200, bos));
    ciz();
    const adres = await screen.findByLabelText('Webhook adresi') as HTMLInputElement;
    expect(adres.readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Kopyala' }));   // jsdom'da navigator.clipboard yok
    expect(await screen.findByText(/Kopyalanamadı/)).toBeTruthy();
    expect(adres.value).toBe(ADRES);
  });
});

describe('ShopifyBaglantiKarti — (c2) imzası tutmayan bildirim "hiç gelmedi"den ayırt edilir', () => {
  const RET = '2026-10-07T09:00:00.000Z';
  const retMetni = (zaman: string) => `Bildirim geldi ama imza doğrulanamadı — imza sırrını kontrol et (son ret: ${tarihSaatYaz(zaman)}).`;

  it('hiç bildirim yok + ret var → "imza doğrulanamadı" (zamanıyla); "Henüz bildirim alınmadı" DENMEZ; rozet "Doğrulanmadı"', async () => {
    // Sunucu reddedilen bildirimde durum dokümanına YALNIZ ret zamanını yazar: diğer alanlar null gelir.
    yonlendir(yanit(200, { ...kayitliBildirimsiz, durum: { sonBildirim: null, sonTopic: null, sonSiparisNo: null, sonSonuc: null, sonHata: null, sonHataZamani: null, sonApiSurumu: null, toplamBildirim: null, sonImzaReddi: RET } }));
    ciz();
    expect(await screen.findByText(retMetni(RET))).toBeTruthy();
    expect(screen.queryByText(/Henüz bildirim alınmadı/)).toBeNull();
    expect(screen.getByText('Doğrulanmadı')).toBeTruthy();
    expect(screen.queryByText('Bağlı')).toBeNull();
    expect(screen.queryByText('Son bildirim')).toBeNull();   // ret "bildirim alındı" SAYILMAZ
  });

  it('ret son bildirimden YENİ → satır görünür ama rozet "Bağlı" kalır (ret yalnız bilgidir)', async () => {
    yonlendir(yanit(200, { ...kayitliBildirimli, durum: { ...durumDolu, sonImzaReddi: RET } }));   // son bildirim 02.10, ret 07.10
    ciz();
    expect(await screen.findByText(retMetni(RET))).toBeTruthy();
    expect(screen.getByText('Bağlı')).toBeTruthy();
    expect(screen.queryByText('Doğrulanmadı')).toBeNull();
    expect(screen.getByText('#1042')).toBeTruthy();
  });

  it('ret son bildirimden ESKİ → satır YOK (alan başarılı bildirimde silinmez; düzelen bağlantıda uyarı kalmaz)', async () => {
    yonlendir(yanit(200, { ...kayitliBildirimli, durum: { ...durumDolu, sonImzaReddi: '2026-10-01T08:00:00.000Z' } }));
    ciz();
    expect(await screen.findByText('Bağlı')).toBeTruthy();
    expect(screen.queryByText(/imza doğrulanamadı/)).toBeNull();
    expect(screen.queryByText(/Henüz bildirim alınmadı/)).toBeNull();
  });

  it.each([
    ['null', null],
    ['alan yok', undefined],
    ['çözülemeyen metin', 'dün sabah'],
  ])('ret zamanı %s + bildirim yok → eski cümle: "Henüz bildirim alınmadı"', async (_ad, deger) => {
    yonlendir(yanit(200, { ...kayitliBildirimsiz, durum: { ...durumDolu, sonBildirim: null, toplamBildirim: null, sonImzaReddi: deger } }));
    ciz();
    expect(await screen.findByText('Henüz bildirim alınmadı — bağlantı doğrulanmadı.')).toBeTruthy();
    expect(screen.queryByText(/imza doğrulanamadı/)).toBeNull();
  });

  it('salt okunur rol (Manager) de ret satırını görür; İngilizce metin sözlükten', async () => {
    yonlendir(yanit(200, { ...kayitliBildirimsiz, durum: { sonImzaReddi: RET } }));
    const tr = ciz('Manager');
    expect(await screen.findByText(retMetni(RET))).toBeTruthy();
    tr.unmount();
    ciz('Admin', 'en');
    expect(await screen.findByText(`A notification arrived but its signature could not be verified — check the signing secret (last rejection: ${tarihSaatYaz(RET, undefined, 'en')}).`)).toBeTruthy();
    expect(screen.queryByText(/No notification received yet/)).toBeNull();
  });
});

describe('ShopifyBaglantiKarti — (d) Kaydet', () => {
  it('ilk kurulum: alan adı + sır POST gövdesinde; istek sürerken düğme kapalı; başarıdan sonra sır alanı TEMİZ', async () => {
    let coz: (v: unknown) => void = () => {};
    const bekleyen = new Promise(r => { coz = r; });
    yonlendir(yanit(200, bos), () => bekleyen);
    const { container } = ciz();
    fireEvent.change(await screen.findByLabelText('Mağaza alan adı'), { target: { value: '  cetpa.myshopify.com ' } });
    fireEvent.change(sirAlani(), { target: { value: SIR } });
    fireEvent.click(kaydetDugmesi());

    const dugme = await screen.findByRole('button', { name: 'Kaydediliyor…' }) as HTMLButtonElement;
    expect(dugme.disabled).toBe(true);
    expect(yazmaIstekleri()).toEqual([{ url: '/api/shopify/baglanti', method: 'POST', govde: { shopDomain: 'cetpa.myshopify.com', webhookSecret: SIR } }]);

    coz(await yanit(200, kayitliBildirimsiz));
    await screen.findByText('Kayıtlı ✓');
    expect(sirAlani().value).toBe('');
    expect(container.innerHTML).not.toContain(SIR);
    expect((kaydetDugmesi() as HTMLButtonElement).disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith('Shopify bağlantısı kaydedildi.', 'success');
    expect(yazmaIstekleri().length).toBe(1);
  });

  it('sır kayıtlıyken boş sır alanı gövdeye `webhookSecret` olarak GİTMEZ (kayıtlı sır korunur)', async () => {
    yonlendir(yanit(200, kayitliBildirimsiz), () => yanit(200, { ...kayitliBildirimsiz, shopDomain: 'yeni-magaza.myshopify.com' }));
    ciz();
    fireEvent.change(await screen.findByLabelText('Mağaza alan adı'), { target: { value: 'yeni-magaza.myshopify.com' } });
    fireEvent.change(sirAlani(), { target: { value: '   ' } });   // yalnız boşluk da "boş"tur
    fireEvent.click(kaydetDugmesi());
    await waitFor(() => expect(yazmaIstekleri().length).toBe(1));
    const { govde } = yazmaIstekleri()[0];
    expect(govde).toEqual({ shopDomain: 'yeni-magaza.myshopify.com' });
    expect(Object.keys(govde as object)).not.toContain('webhookSecret');
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Shopify bağlantısı kaydedildi.', 'success'));
    expect(alanAdiAlani().value).toBe('yeni-magaza.myshopify.com');
  });

  it('ilk kurulumda sır boşsa ya da alan adı boşsa POST ATILMAZ, neden söylenir', async () => {
    yonlendir(yanit(200, bos));
    ciz();
    await screen.findByLabelText('Mağaza alan adı');
    fireEvent.click(kaydetDugmesi());
    expect(await screen.findByText(/Mağaza alan adını gir/)).toBeTruthy();
    fireEvent.change(alanAdiAlani(), { target: { value: 'cetpa.myshopify.com' } });
    fireEvent.click(kaydetDugmesi());
    expect(await screen.findByText('İlk kurulumda imza sırrı zorunlu.')).toBeTruthy();
    expect(yazmaIstekleri()).toEqual([]);
  });
});

describe('ShopifyBaglantiKarti — (e) sunucu hata metni gösterilir', () => {
  it('409: `error` metni ekranda ve bildirimde; yazılan sır silinmez (yeniden denenebilsin), durum değişmez', async () => {
    const mesaj = 'Bu mağaza alan adı başka bir firmaya bağlı.';
    yonlendir(yanit(200, bos), () => yanit(409, { success: false, error: mesaj }));
    ciz();
    fireEvent.change(await screen.findByLabelText('Mağaza alan adı'), { target: { value: 'baskasinin.myshopify.com' } });
    fireEvent.change(sirAlani(), { target: { value: SIR } });
    fireEvent.click(kaydetDugmesi());
    expect((await screen.findByText(mesaj)).getAttribute('role')).toBe('alert');
    expect(toast).toHaveBeenCalledWith(mesaj, 'error');
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    expect(sirAlani().value).toBe(SIR);
    expect(screen.getByText('Bağlı Değil')).toBeTruthy();
    expect((kaydetDugmesi() as HTMLButtonElement).disabled).toBe(false);
  });

  it('hata yanıtı JSON değilse (IIS sayfası) HTTP koduyla genel metin', async () => {
    yonlendir(yanit(200, bos), () => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('Unexpected token <')) }));
    ciz();
    fireEvent.change(await screen.findByLabelText('Mağaza alan adı'), { target: { value: 'cetpa.myshopify.com' } });
    fireEvent.change(sirAlani(), { target: { value: SIR } });
    fireEvent.click(kaydetDugmesi());
    expect(await screen.findByText('Bağlantı kaydedilemedi (HTTP 502)')).toBeTruthy();
  });
});

describe('ShopifyBaglantiKarti — (f) durum okunamazsa kart çökmez', () => {
  it('GET 403 → "durum okunamadı" + rol notu; form ve rozet yok', async () => {
    yonlendir(yanit(403, { success: false, error: 'Yetkisiz' }));
    const { container } = ciz('Manager');
    expect(await screen.findByText('Bağlantı durumu okunamadı.')).toBeTruthy();
    expect(screen.getByText('Bu rol Shopify bağlantı durumunu göremez.')).toBeTruthy();
    expect(container.querySelectorAll('input').length).toBe(0);
    expect(screen.queryByText('Bağlı')).toBeNull();
    expect(screen.queryByText('Bağlı Değil')).toBeNull();
  });

  it('ağ hatası (istek reddedildi) → "durum okunamadı"; Admin\'de de form açılmaz, "Bağlı" yok', async () => {
    authFetch.mockImplementation(() => Promise.reject(new Error('Failed to fetch')));
    const { container } = ciz('Admin');
    expect(await screen.findByText('Bağlantı durumu okunamadı.')).toBeTruthy();
    expect(screen.queryByText('Bu rol Shopify bağlantı durumunu göremez.')).toBeNull();
    expect(container.querySelectorAll('input').length).toBe(0);
    expect(screen.queryByRole('button', { name: 'Kaydet' })).toBeNull();
    expect(screen.queryByText('Bağlı')).toBeNull();
  });

  it('200 ama gövde beklenen biçimde değil / JSON değil → "durum okunamadı"; Yenile yeniden dener ve düzelir', async () => {
    yonlendir(Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token <')) }));
    ciz();
    expect(await screen.findByText('Bağlantı durumu okunamadı.')).toBeTruthy();
    yonlendir(yanit(200, kayitliBildirimli));
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(await screen.findByText('Bağlı')).toBeTruthy();
    expect(screen.queryByText('Bağlantı durumu okunamadı.')).toBeNull();
    expect(alanAdiAlani().value).toBe('cetpa.myshopify.com');
  });
});

describe('ShopifyBaglantiKarti — bağlantıyı kaldır (onaylı)', () => {
  it('onay verilmezse istek ATILMAZ', async () => {
    yonlendir(yanit(200, kayitliBildirimli));
    confirmAction.mockResolvedValue(false);
    ciz();
    fireEvent.click(await screen.findByRole('button', { name: /Bağlantıyı kaldır/ }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(confirmAction.mock.calls[0][0]).toMatchObject({ title: 'Shopify bağlantısı kaldırılsın mı?', variant: 'danger' });
    expect(yazmaIstekleri()).toEqual([]);
  });

  it('onaylanınca POST /kaldir, ardından durum yeniden okunur ve form boşalır', async () => {
    // Sunucu gibi davranan sahte: kaldırma isteğinden SONRAKİ GET boş kayıt döner.
    let kaldirildi = false;
    authFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') { kaldirildi = true; return yanit(200, { success: true }); }
      return yanit(200, kaldirildi ? bos : kayitliBildirimli);
    });
    confirmAction.mockResolvedValue(true);
    ciz();
    fireEvent.click(await screen.findByRole('button', { name: /Bağlantıyı kaldır/ }));
    expect(await screen.findByText('Bağlı Değil')).toBeTruthy();
    expect(yazmaIstekleri()).toMatchObject([{ url: '/api/shopify/baglanti/kaldir', method: 'POST' }]);
    expect(screen.queryByText('Bağlı')).toBeNull();
    expect(alanAdiAlani().value).toBe('');
    expect(screen.queryByText('Kayıtlı ✓')).toBeNull();
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Shopify bağlantısı kaldırıldı.', 'success'));
  });

  it('kaldırma reddedilirse (403) sunucu metni gösterilir, kayıt ekranda kalır', async () => {
    yonlendir(yanit(200, kayitliBildirimli), () => yanit(403, { success: false, error: 'Bu işlem için Admin yetkisi gerekir.' }));
    confirmAction.mockResolvedValue(true);
    ciz();
    fireEvent.click(await screen.findByRole('button', { name: /Bağlantıyı kaldır/ }));
    expect(await screen.findByText('Bu işlem için Admin yetkisi gerekir.')).toBeTruthy();
    expect(screen.getByText('Bağlı')).toBeTruthy();
  });
});

describe('ShopifyBaglantiKarti — dil', () => {
  it('İngilizce: metinler sözlükten; bilinmeyen sonuç kodu ham hâliyle (büyütülmeden)', async () => {
    yonlendir(yanit(200, { ...kayitliBildirimli, durum: { ...durumDolu, sonSonuc: 'yeni_kod' } }));
    ciz('Admin', 'en');
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.getByLabelText('Signing secret')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByText(/yeni_kod/)).toBeTruthy();
  });
});

describe('DEĞİŞMEZ: Ayarlar sayfası kartı kullanır, eski sır alanları geri gelmez', () => {
  // "Yazıldı ama bağlanmadı" arıza sınıfı: bileşen var, sayfa onu çizmiyor. Yorum satırları sayılmaz.
  const kod = readFileSync(join(__dirname, '..', 'pages', 'SettingsPage.tsx'), 'utf-8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

  it('SettingsPage <ShopifyBaglantiKarti> çizer ve rolü + dili geçirir', () => {
    expect(kod).toMatch(/import ShopifyBaglantiKarti from '\.\.\/components\/ShopifyBaglantiKarti'/);
    expect(kod).toMatch(/<ShopifyBaglantiKarti\s+currentLanguage=\{currentLanguage\}\s+userRole=\{userRole\}\s+superYonetici=\{isOwnerAdmin\}\s*\/>/);
  });

  it('SettingsPage kodunda `shopify_*` ayar anahtarı ve eski senkron çağrısı YOK', () => {
    expect(kod.match(/shopify_[a-z_]+/g) ?? []).toEqual([]);
    expect(kod).not.toContain('/api/shopify/sync');
    expect(kod).not.toMatch(/Senkronize Et|Sync Now/);
  });
});
