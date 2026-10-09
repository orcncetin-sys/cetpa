/**
 * OnlineSiparislerPage.test.tsx — "Online Siparişler" ekranı (şartname online-siparis 2026-10-02 §4/§5: süzme,
 * rozetler, boş durumlar; şerit 403'te gizlenir).
 *
 * Sayfa GERÇEKTEN çizilir; yalnız `authFetch` (bağlantı durumu ucu) sahtedir. Seçiciler ARIA rolüne dayanır
 * (repoda data-testid yok): şerit `status`, özet kutusu `group`, çipler `aria-pressed` düğme, satır `row`.
 * Saf hesapların ayrıntılı vakaları utils/siparisler/magazaSiparisi.test.ts'te; burada EKRANA ulaştıkları sınanır.
 *
 * TAZELEME (2026-10-07): şerit dakikada bir (sekme görünürken) ve sekme görünür olunca yeniden okunur; "Bugün" kutusu
 * gün dönünce `orders` DEĞİŞMEDEN yeniden sayılır. Bu vakalar sahte saatle koşar — yalnız `setInterval` ve `Date`
 * sahtedir (RTL ve motion'ın kullandığı öteki zamanlayıcılar gerçek kalır).
 *
 * 2. TUR (2026-10-07): imza reddi şeritte de görünür (kartla ortak kural, yeşil etiket düşmez); geciken eski yanıt yeni
 * durumu ezmez (istek sırası — yanıtların ters sırayla döndüğü vakalar).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import OnlineSiparislerPage from './OnlineSiparislerPage';
import { authFetch } from '../services/authFetch';
import { tarihSaatYaz } from '../utils/zaman';
import type { Order } from '../types';

vi.mock('../services/authFetch', () => ({ authFetch: vi.fn() }));
const sahteFetch = vi.mocked(authFetch);

const yanit = (govde: unknown, durum = 200) => new Response(JSON.stringify(govde), { status: durum, headers: { 'Content-Type': 'application/json' } });
const BAGLI = {
  success: true, configured: true, shopDomain: 'cetpa.myshopify.com', webhookSirriKayitli: true,
  webhookAdresi: 'https://app.cetpa.com.tr/api/shopify/webhook', webhookYolu: '/api/shopify/webhook',
  durum: { sonBildirim: '2026-10-02T09:15:00.000Z', sonTopic: 'orders/create', sonSiparisNo: '#1003', sonSonuc: 'yazildi', sonHata: null, sonHataZamani: null, sonApiSurumu: '2025-07', toplamBildirim: 12 },
};
const KURULMAMIS = { success: true, configured: false, shopDomain: null, webhookSirriKayitli: false, webhookAdresi: null, webhookYolu: '/api/shopify/webhook', durum: null };

const siparis = (ek: Partial<Order>): Order => ({
  id: 'x', customerName: 'Müşteri', totalPrice: 100, status: 'Pending', customerType: 'Retail',
  source: 'shopify_webhook', paraBirimi: 'TRY', createdAt: '2026-10-01T10:00:00+03:00',
  shopifyRaw: { financialStatus: 'pending', fulfillmentStatus: null, cancelReason: null, cancelledAt: null, odemeYontemi: null, vergi: null, vergiDahil: null },
  ...ek,
});

const SIPARISLER: Order[] = [
  siparis({ id: 'm1', shopifyOrderId: '#1001', customerName: 'IŞIK İnşaat', teslimatSehri: 'İzmir', customerEmail: 'satinalma@isik.com.tr', customerPhone: '+90 532 123 45 67',
    totalPrice: 1250.5, lineItems: [{ id: '1', sku: 'A', name: 'Boya', quantity: 2, price: 0 }, { id: '2', sku: 'B', name: 'Fırça', quantity: 1, price: 0 }], createdAt: '2026-10-01T10:00:00+03:00' }),
  siparis({ id: 'm2', shopifyOrderId: '#1002', customerName: 'Çağrı Öztürk', status: 'Shipped', paid: true, totalPrice: 400, createdAt: '2026-10-01T12:00:00+03:00',
    shopifyRaw: { financialStatus: 'paid', fulfillmentStatus: 'fulfilled', cancelReason: null, cancelledAt: null, odemeYontemi: 'iyzico', vergi: null, vergiDahil: null } }),
  // TRY dışı: totalPrice sunucuda YAZILMAZ (çalışma anında yok) — tip zorunlu dediği için test verisinde açıkça silinir.
  (() => { const o = siparis({ id: 'm3', shopifyOrderId: '#1003', customerName: 'John Smith', paraBirimi: 'USD', dovizTutar: 99.9, status: 'Processing', paid: true, createdAt: '2026-10-01T14:00:00+03:00',
    shopifyRaw: { financialStatus: 'paid', fulfillmentStatus: null, cancelReason: null, cancelledAt: null, odemeYontemi: null, vergi: null, vergiDahil: null } });
    Reflect.deleteProperty(o, 'totalPrice'); return o; })(),
  siparis({ id: 'm4', shopifyOrderId: '#1004', customerName: 'İptal Edilen', status: 'Cancelled', totalPrice: 9999, createdAt: '2026-09-30T10:00:00+03:00' }),
  // Mağaza siparişi OLMAYANLAR — ekranda görünmemeli. `shopifyOrderId` elle girilen siparişte de vardır.
  siparis({ id: 'n1', source: undefined, shopifyOrderId: 'SHP-AAAA1111', customerName: 'Elle Girilen', totalPrice: 5000 }),
  siparis({ id: 'n2', source: 'mikro-fatura', orderNumber: 'MF-A12', shopifyOrderId: undefined, customerName: 'Mikro Faturası', totalPrice: 7000 }),
  siparis({ id: 'n3', source: 'Trendyol', shopifyOrderId: undefined, orderNumber: 'TY-9', customerName: 'Pazaryeri', totalPrice: 300 }),
];

const bekle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

async function ciz(ek: Partial<React.ComponentProps<typeof OnlineSiparislerPage>> = {}) {
  const onSiparisAc = vi.fn();
  const sonuc = render(<OnlineSiparislerPage orders={SIPARISLER} currentLanguage="tr" onSiparisAc={onSiparisAc} {...ek} />);
  await bekle();
  return { ...sonuc, onSiparisAc };
}
const satirlar = () => screen.getAllByRole('row').slice(1);   // başlık satırı hariç
/** Görünen satırların sipariş numaraları (ilk hücre) — satır metni no + tarihi bitişik verdiği için hücreden okunur. */
const nolar = () => satirlar().map(s => within(s).getAllByRole('cell')[0].textContent);
const cip = (ad: RegExp) => screen.getByRole('button', { name: ad });
const kutu = (ad: string) => screen.getByRole('group', { name: ad });

beforeEach(() => {
  sahteFetch.mockReset();
  sahteFetch.mockImplementation(() => Promise.resolve(yanit(BAGLI)));
});

describe('süzme — yalnız `source === shopify_webhook`', () => {
  it('mağaza siparişleri listelenir; elle girilen (SHP-…), Mikro faturası ve pazaryeri siparişi GÖRÜNMEZ', async () => {
    await ciz();
    expect(satirlar()).toHaveLength(4);
    const metin = screen.getByRole('table').textContent ?? '';
    for (const no of ['#1001', '#1002', '#1003', '#1004']) expect(metin).toContain(no);
    for (const yok of ['SHP-AAAA1111', 'MF-A12', 'TY-9', 'Elle Girilen', 'Mikro Faturası', 'Pazaryeri']) expect(metin).not.toContain(yok);
  });
  it('en yeni sipariş üstte', async () => {
    await ciz();
    expect(nolar()).toEqual(['#1003', '#1002', '#1001', '#1004']);
  });
  it('bağlantı ucu tam olarak GET /api/shopify/baglanti ile sorulur (gövde / yöntem yok)', async () => {
    await ciz();
    expect(sahteFetch).toHaveBeenCalledTimes(1);
    expect(sahteFetch).toHaveBeenCalledWith('/api/shopify/baglanti');
  });
});

describe('satır içeriği ve rozetler', () => {
  it('müşteri + şehir, kalem sayısı, tutar + para birimi', async () => {
    await ciz();
    const s1001 = satirlar().find(s => s.textContent?.includes('#1001'));
    expect(s1001).toBeDefined();
    const h = within(s1001 as HTMLElement);
    expect(h.getByText('IŞIK İnşaat')).toBeTruthy();
    expect(h.getByText('İzmir')).toBeTruthy();
    expect(h.getByText('₺1.250,50')).toBeTruthy();
    expect(h.getByText('TRY')).toBeTruthy();
    expect(h.getAllByRole('cell')[5].textContent).toBe('2');
  });
  it("kalem dizisi yazılmamış siparişte kalem '—' ('0' UYDURULMAZ)", async () => {
    await ciz();
    const s1002 = satirlar().find(s => s.textContent?.includes('#1002')) as HTMLElement;
    expect(within(s1002).getAllByRole('cell')[5].textContent).toBe('—');
  });
  it('ödeme rozeti: bekleyen → "Ödeme bekliyor", ödenen → "Ödendi"', async () => {
    await ciz();
    const s1001 = satirlar().find(s => s.textContent?.includes('#1001')) as HTMLElement;
    const s1002 = satirlar().find(s => s.textContent?.includes('#1002')) as HTMLElement;
    expect(within(s1001).getAllByRole('cell')[3].textContent).toBe('Ödeme bekliyor');
    expect(within(s1002).getAllByRole('cell')[3].textContent).toBe('Ödendi');
  });
  it('kargo rozeti: gönderilmemiş → "Hazırlanmadı", Cetpa durumu Kargoda → "Kargoda", iptal → "İptal Edildi"', async () => {
    await ciz();
    const hucre = (no: string) => within(satirlar().find(s => s.textContent?.includes(no)) as HTMLElement).getAllByRole('cell')[4].textContent;
    expect(hucre('#1001')).toBe('Hazırlanmadı');
    expect(hucre('#1002')).toBe('Kargoda');
    expect(hucre('#1004')).toBe('İptal Edildi');
  });
  it("Cetpa'da ödendi işaretli + mağazada bekleyen sipariş: rozet 'Ödendi', ipucu mağazadaki durumu söyler", async () => {
    await ciz({ orders: [siparis({ id: 'h', shopifyOrderId: '#2001', paid: true })] });
    const rozet = screen.getByText('Ödendi');
    expect(rozet.getAttribute('title')).toBe("Cetpa'da ödendi olarak işaretlendi · Mağazadaki durum: Ödeme bekliyor");
  });
  it('TRY dışı sipariş: dovizTutar kendi birimiyle; TL tutarı uydurulmaz', async () => {
    await ciz();
    const s1003 = satirlar().find(s => s.textContent?.includes('#1003')) as HTMLElement;
    const tutar = within(s1003).getAllByRole('cell')[6].textContent ?? '';
    expect(tutar).toContain('$');
    expect(tutar).toContain('99');
    expect(tutar).toContain('USD');
    expect(tutar).not.toContain('₺');
  });
  it("tutarı hiç olmayan sipariş '—' basar ('₺0,00' DEĞİL)", async () => {
    const o = siparis({ id: 't', shopifyOrderId: '#3001' });
    Reflect.deleteProperty(o, 'totalPrice');
    await ciz({ orders: [o] });
    const tutar = within(satirlar()[0]).getAllByRole('cell')[6].textContent;
    expect(tutar).toBe('—');
    expect(screen.queryByText('₺0,00')).toBeNull();
  });
  it('EN: rozetler çevrilir, ham Shopify değeri (partially_paid / pending) ekrana sızmaz', async () => {
    await ciz({ currentLanguage: 'en' });
    const s1001 = satirlar().find(s => s.textContent?.includes('#1001')) as HTMLElement;
    const hucreler = within(s1001).getAllByRole('cell').map(h => h.textContent);
    expect(hucreler[3]).toBe('Payment pending');   // ham 'pending' DEĞİL
    expect(hucreler[4]).toBe('Unfulfilled');
    // Hiçbir rozet ham slug basmaz (alt çizgili Shopify değeri yok).
    for (const satir of satirlar()) for (const i of [3, 4]) expect(within(satir).getAllByRole('cell')[i].textContent).not.toMatch(/_|^(pending|paid|fulfilled|partial)$/);
    expect(screen.getByRole('heading', { name: 'Online Orders' })).toBeTruthy();
  });
});

describe('özet kutuları', () => {
  it('ödeme bekleyen / hazırlanacak / kargoda sayıları (iptal hariç)', async () => {
    await ciz();
    expect(kutu('Ödeme bekleyen').textContent).toContain('1');
    expect(within(kutu('Hazırlanacak')).getByText('2')).toBeTruthy();
    expect(kutu('Hazırlanacak').textContent).toContain('Ödeme bekleyen: 1');
    expect(within(kutu('Kargoda')).getByText('1')).toBeTruthy();
  });
  it('TOPLAM yalnız TL ve iptal hariç; toplama giremeyen sipariş NOT olarak yazılır (sahte sıfır yok)', async () => {
    await ciz();
    const toplam = kutu('Toplam Tutar');
    expect(toplam.textContent).toContain('₺1.650,50');           // 1.250,50 + 400; iptal (9.999) ve USD (99,9) GİRMEZ
    expect(within(toplam).getByRole('note').textContent).toBe('1 sipariş toplama girmedi (1 TRY dışı)');
  });
  it("hiçbir siparişin TL tutarı bilinmiyorsa toplam '—' ('₺0,00' DEĞİL) + not", async () => {
    const o = siparis({ id: 'u', shopifyOrderId: '#4001', paraBirimi: 'EUR', dovizTutar: 10 });
    Reflect.deleteProperty(o, 'totalPrice');
    await ciz({ orders: [o] });
    const toplam = kutu('Toplam Tutar');
    expect(toplam.textContent).toContain('—');
    expect(toplam.textContent).not.toContain('₺0');
    expect(within(toplam).getByRole('note').textContent).toContain('1 sipariş toplama girmedi');
  });
  it('her sipariş TL ise not YOK', async () => {
    await ciz({ orders: [siparis({ id: 'a', shopifyOrderId: '#1', totalPrice: 10 })] });
    expect(within(kutu('Toplam Tutar')).queryByRole('note')).toBeNull();
  });
});

describe('durum çipleri ve arama', () => {
  it('altı çip sayılarıyla; varsayılan "Tümü" basılı', async () => {
    await ciz();
    expect(cip(/^Tümü 4$/).getAttribute('aria-pressed')).toBe('true');
    expect(cip(/^Ödeme bekliyor 1$/)).toBeTruthy();
    expect(cip(/^Hazırlanacak 2$/)).toBeTruthy();
    expect(cip(/^Kargoda 1$/)).toBeTruthy();
    expect(cip(/^Teslim Edildi 0$/)).toBeTruthy();
    expect(cip(/^İptal 1$/)).toBeTruthy();
  });
  it('çipe basınca liste süzülür', async () => {
    await ciz();
    fireEvent.click(cip(/^Kargoda/));
    expect(satirlar()).toHaveLength(1);
    expect(satirlar()[0].textContent).toContain('#1002');
    fireEvent.click(cip(/^İptal/));
    expect(satirlar()[0].textContent).toContain('#1004');
    fireEvent.click(cip(/^Hazırlanacak/));
    expect(nolar()).toEqual(['#1003', '#1001']);
  });
  it('süzgece uyan sipariş yoksa mesaj + "Süzgeci temizle" (tablo yerine); temizleyince liste geri gelir', async () => {
    await ciz();
    fireEvent.click(cip(/^Teslim Edildi/));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Bu süzgece uyan sipariş yok')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Süzgeci temizle' }));
    expect(satirlar()).toHaveLength(4);
  });
  it('arama: sipariş no, Türkçe-duyarlı müşteri adı, e-posta, telefon', async () => {
    await ciz();
    const kutucuk = screen.getByRole('searchbox', { name: 'Sipariş ara' });
    const ara = (q: string) => { fireEvent.change(kutucuk, { target: { value: q } }); return screen.queryByRole('table') ? nolar() : []; };
    expect(ara('1002')).toEqual(['#1002']);
    expect(ara('ışık')).toEqual(['#1001']);          // kayıt "IŞIK": toLowerCase() 'işik' üretirdi, eşleşmezdi
    expect(ara('çağrı öztürk')).toEqual(['#1002']);
    expect(ara('satinalma@isik')).toEqual(['#1001']);
    expect(ara('0532 123')).toEqual(['#1001']);
    expect(ara('yok böyle biri')).toEqual([]);
  });
});

describe('sipariş detayı', () => {
  it('sipariş no düğmesi `onSiparisAc`i O siparişle, TEK kez çağırır — satır tıklamasına ayrıca düşmez (App: setSelectedOrder + setActiveTab("orders"))', async () => {
    const { onSiparisAc } = await ciz();
    fireEvent.click(screen.getByRole('button', { name: '#1002' }));
    expect(onSiparisAc).toHaveBeenCalledTimes(1);
    expect(onSiparisAc.mock.calls[0][0]).toBe(SIPARISLER[1]);
  });
  it('satırın herhangi bir yerine (ör. müşteri hücresi) tıklamak da açar', async () => {
    const { onSiparisAc } = await ciz();
    fireEvent.click(within(satirlar()[0]).getAllByRole('cell')[2]);
    expect(onSiparisAc).toHaveBeenCalledTimes(1);
    expect(onSiparisAc.mock.calls[0][0]).toBe(SIPARISLER[2]);   // en üstteki satır #1003
  });
});

describe('bağlantı durumu şeridi', () => {
  it('bağlı: alan adı, son sipariş, toplam bildirim', async () => {
    await ciz();
    const serit = screen.getByRole('status', { name: 'Mağaza bağlantısı' });
    expect(serit.textContent).toContain('Mağaza bağlı · cetpa.myshopify.com');
    expect(serit.textContent).toContain('Son sipariş: #1003');
    expect(serit.textContent).toContain('Toplam bildirim: 12');
    expect(serit.textContent).toContain('Son bildirim:');
  });
  it('bağlı ama bildirim hiç gelmemiş (durum null): "Henüz bildirim gelmedi"; toplam bildirim "0" UYDURULMAZ', async () => {
    sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: null })));
    await ciz();
    const serit = screen.getByRole('status');
    expect(serit.textContent).toContain('Henüz bildirim gelmedi');
    expect(serit.textContent).not.toContain('Toplam bildirim');
  });
  it('son hata varsa şeritte yazılır; imza sırrı kayıtlı değilse uyarılır', async () => {
    sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, webhookSirriKayitli: false, durum: { ...BAGLI.durum, sonHata: 'Kiracı bulunamadı', sonHataZamani: '2026-10-02T08:00:00.000Z' } })));
    await ciz();
    const serit = screen.getByRole('status');
    expect(serit.textContent).toContain('Kiracı bulunamadı');
    expect(serit.textContent).toContain('İmza sırrı kayıtlı değil');
  });
  describe('imza reddi — bildirim GELİYOR ama imzası tutmuyor (kartla ortak kural)', () => {
    const RET = '2026-10-07T09:00:00.000Z';
    const uyari = (zaman: string) => `Mağazadan bildirim geldi ama imza doğrulanamadı — yöneticinize haber verin (son ret: ${tarihSaatYaz(zaman)}).`;
    const BOS_DURUM = { sonBildirim: null, sonTopic: null, sonSiparisNo: null, sonSonuc: null, sonHata: null, sonHataZamani: null, sonApiSurumu: null, toplamBildirim: null };

    it.each([
      ['sunucunun tam durum nesnesi', { ...BOS_DURUM, sonImzaReddi: RET }],
      ['yalnız `sonImzaReddi` alanı', { sonImzaReddi: RET }],
    ])('hiç bildirim yok + ret var (%s) → uyarı VAR, "Henüz bildirim gelmedi" YOK; yeşil «Mağaza bağlı» etiketi KALIR', async (_ad, durum) => {
      sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum })));
      await ciz();
      const serit = screen.getByRole('status', { name: 'Mağaza bağlantısı' });
      expect(within(serit).getByText(uyari(RET))).toBeTruthy();
      expect(serit.textContent).not.toContain('Henüz bildirim gelmedi');
      expect(serit.textContent).toContain('Son bildirim: —');
      // Ret yalnız BİLGİDİR: etiket «bağlı» der, «kurulmamış» uyarısına dönmez.
      expect(serit.textContent).toContain('Mağaza bağlı · cetpa.myshopify.com');
      expect(serit.textContent).not.toContain('kurulmamış');
    });
    it('ret, son KABUL edilen bildirimden ESKİ → uyarı YOK (bağlantı sonradan düzelmiş)', async () => {
      sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: { ...BAGLI.durum, sonImzaReddi: '2026-10-01T08:00:00.000Z' } })));
      await ciz();
      const serit = screen.getByRole('status');
      expect(serit.textContent).not.toContain('imza doğrulanamadı');
      expect(serit.textContent).toContain('Toplam bildirim: 12');
    });
    it('ret, son bildirimden YENİ → uyarı VAR; son bildirim tarihi ve sayaç yine yazılır', async () => {
      sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: { ...BAGLI.durum, sonImzaReddi: RET } })));   // son bildirim 02.10, ret 07.10
      await ciz();
      const serit = screen.getByRole('status');
      expect(within(serit).getByText(uyari(RET))).toBeTruthy();
      expect(serit.textContent).toContain(`Son bildirim: ${tarihSaatYaz(BAGLI.durum.sonBildirim)}`);
      expect(serit.textContent).toContain('Toplam bildirim: 12');
      expect(serit.textContent).toContain('Mağaza bağlı · cetpa.myshopify.com');
    });
    it('ret zamanı çözülemiyorsa (metin değil / bozuk tarih) uyarı YOK — "hiç bildirim yok" hâli olduğu gibi kalır', async () => {
      for (const deger of [1759827600000, 'dün sabah', '']) {
        sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: { ...BOS_DURUM, sonImzaReddi: deger } })));
        const { unmount } = await ciz();
        const serit = screen.getByRole('status');
        expect(serit.textContent, String(deger)).not.toContain('imza doğrulanamadı');
        expect(serit.textContent, String(deger)).toContain('Henüz bildirim gelmedi');
        unmount();
      }
    });
    it('EN: uyarı çevrilir, yer tutucu dolar', async () => {
      sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: { sonImzaReddi: RET } })));
      await ciz({ currentLanguage: 'en' });
      const serit = screen.getByRole('status');
      expect(serit.textContent).toContain(`let your administrator know (last rejection: ${tarihSaatYaz(RET, undefined, 'en')}).`);
      expect(serit.textContent).not.toContain('{zaman}');
      expect(serit.textContent).not.toContain('No notification received yet');
    });
  });
  it.each([
    ['403 (yetki yok)', () => Promise.resolve(yanit({ success: false, error: 'Yetkisiz' }, 403))],
    ['404 (uç henüz yayında değil)', () => Promise.resolve(new Response('<html>Not Found</html>', { status: 404 }))],
    ['200 ama JSON değil (IIS hata sayfası)', () => Promise.resolve(new Response('<html></html>', { status: 200 }))],
    ['200 ama beklenmeyen gövde', () => Promise.resolve(yanit({ success: true }))],
    ['ağ hatası', () => Promise.reject(new Error('Failed to fetch'))],
  ])('%s → şerit GİZLENİR, sayfa çalışmaya devam eder', async (_ad, uret) => {
    sahteFetch.mockImplementation(uret);
    await ciz();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(satirlar()).toHaveLength(4);
    expect(cip(/^Tümü 4$/)).toBeTruthy();
  });
  it('bağlantı kurulmamış ama eski siparişler var: şerit uyarır + "Bağlantıyı kur" Ayarlar\'a götürür', async () => {
    sahteFetch.mockImplementation(() => Promise.resolve(yanit(KURULMAMIS)));
    const ayarlaraGit = vi.fn();
    await ciz({ ayarlaraGit });
    const serit = screen.getByRole('status');
    expect(serit.textContent).toContain('Mağaza bağlantısı kurulmamış');
    fireEvent.click(within(serit).getByRole('button', { name: 'Bağlantıyı kur' }));
    expect(ayarlaraGit).toHaveBeenCalledTimes(1);
    expect(satirlar()).toHaveLength(4);
  });
  it('yanıtta sır alanı gelse bile ekrana BASILMAZ', async () => {
    sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, webhookSecret: 'cok-gizli-deger' })));
    const { container } = await ciz();
    expect(container.textContent).not.toContain('cok-gizli-deger');
  });
});

describe('boş durumlar — hiç mağaza siparişi yok', () => {
  const MAGAZASIZ = SIPARISLER.filter(o => o.source !== 'shopify_webhook');

  it('bağlantı KURULMAMIŞ + `ayarlaraGit` verilmiş (bağlantıyı düzenleyebilen rol): kurulum yönlendirmesi (Ayarlar → Entegrasyonlar) + düğme', async () => {
    sahteFetch.mockImplementation(() => Promise.resolve(yanit(KURULMAMIS)));
    const ayarlaraGit = vi.fn();
    await ciz({ orders: MAGAZASIZ, ayarlaraGit });
    expect(screen.getByRole('heading', { name: 'Mağaza bağlantısı kurulmamış' })).toBeTruthy();
    expect(screen.getByText(/Ayarlar → Entegrasyonlar → Shopify/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bağlantıyı kur' }));
    expect(ayarlaraGit).toHaveBeenCalledTimes(1);
    // Aynı uyarı iki kez basılmaz: şerit yok, tablo / çip / özet yok.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });
  it('bağlantı KURULMAMIŞ + `ayarlaraGit` YOK (Manager dâhil, düzenleyemeyen rol): düğme çizilmez, "yönetici kurar" notu', async () => {
    sahteFetch.mockImplementation(() => Promise.resolve(yanit(KURULMAMIS)));
    await ciz({ orders: MAGAZASIZ });
    expect(screen.queryByRole('button', { name: 'Bağlantıyı kur' })).toBeNull();
    expect(screen.getByText(/Bağlantıyı yalnız yönetici kurabilir/)).toBeTruthy();
  });
  it('bağlantı KURULU: "Henüz online sipariş yok" + şerit bağlı', async () => {
    await ciz({ orders: MAGAZASIZ });
    expect(screen.getByRole('heading', { name: 'Henüz online sipariş yok' })).toBeTruthy();
    expect(screen.getByText('Mağaza bağlı. İlk sipariş geldiğinde burada görünür.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Mağaza bağlı');
    expect(screen.queryByText(/kurulmamış/)).toBeNull();
  });
  it('bağlantı durumu BİLİNMİYOR (403): yansız boş durum — ne "bağlı" ne "kurulmamış" DENMEZ', async () => {
    sahteFetch.mockImplementation(() => Promise.resolve(yanit({ success: false }, 403)));
    await ciz({ orders: MAGAZASIZ });
    expect(screen.getByRole('heading', { name: 'Henüz online sipariş yok' })).toBeTruthy();
    expect(screen.getByText('Mağazadan sipariş geldiğinde burada görünür.')).toBeTruthy();
    expect(screen.queryByText(/Mağaza bağlı/)).toBeNull();
    expect(screen.queryByText(/kurulmamış/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('sipariş listesi tamamen boşken de çöker değil', async () => {
    await ciz({ orders: [] });
    expect(screen.getByRole('heading', { name: 'Henüz online sipariş yok' })).toBeTruthy();
  });
});

// ── TAZELEME ────────────────────────────────────────────────────────────────────────────────────────────────

const DAKIKA = 60_000;
/** Sahte saati ilerletir (aralık zamanlayıcıları koşar) ve bekleyen yanıtların ekrana ulaşmasını bekler. */
const ilerlet = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await bekle(); };
/** jsdom'da `visibilityState` salt okunur bir alıcıdır; test, belgenin kendi özelliğiyle gölgeler (afterEach geri alır). */
const gorunurluk = (hal: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hal });
const gorunurlukOlayi = async () => { await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await bekle(); };

describe('bağlantı şeridi — tazeleme (sipariş sayısı DEĞİŞMEDEN)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); });
  afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(document, 'visibilityState'); });

  it('düzenek: jsdom sekmeyi GÖRÜNÜR sayıyor (aksi hâlde aşağıdaki vakalar boşa geçerdi)', () => {
    expect(document.visibilityState).toBe('visible');
  });

  it('dakikada bir yeniden okunur: işlenemeyen bildirimin hatası ve yeni "toplam bildirim" ekrana düşer', async () => {
    await ciz();
    expect(sahteFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 12');
    // Bildirim geldi, işlenemedi: sipariş YAZILMADI (liste aynı), sunucudaki durum değişti.
    sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: { ...BAGLI.durum, toplamBildirim: 13, sonSonuc: 'hata', sonHata: 'Sipariş yazılamadı', sonHataZamani: '2026-10-02T09:20:00.000Z' } })));
    await ilerlet(DAKIKA - 1);
    expect(sahteFetch).toHaveBeenCalledTimes(1);          // süre dolmadan yoklanmaz
    await ilerlet(1);
    expect(sahteFetch).toHaveBeenCalledTimes(2);
    expect(sahteFetch).toHaveBeenLastCalledWith('/api/shopify/baglanti');
    const serit = screen.getByRole('status');
    expect(serit.textContent).toContain('Toplam bildirim: 13');
    expect(serit.textContent).toContain('Sipariş yazılamadı');
    await ilerlet(DAKIKA);
    expect(sahteFetch).toHaveBeenCalledTimes(3);          // tek seferlik değil, sürekli
  });

  it.each([
    ['ağ hatası', () => Promise.reject(new Error('Failed to fetch'))],
    ['500', () => Promise.resolve(yanit({ success: false, error: 'pg yok' }, 500))],
    ['200 ama JSON değil', () => Promise.resolve(new Response('<html></html>', { status: 200 }))],
    ['200 ama beklenmeyen gövde', () => Promise.resolve(yanit({ success: true }))],
  ])('tazeleme turunda %s → ELDEKİ durum korunur (şerit kaybolmaz)', async (_ad, uret) => {
    await ciz();
    sahteFetch.mockImplementation(uret);
    await ilerlet(DAKIKA);
    expect(sahteFetch).toHaveBeenCalledTimes(2);
    const serit = screen.getByRole('status', { name: 'Mağaza bağlantısı' });
    expect(serit.textContent).toContain('Mağaza bağlı · cetpa.myshopify.com');
    expect(serit.textContent).toContain('Toplam bildirim: 12');
    // Hata geçince bir sonraki tur yeni durumu yazar.
    sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: { ...BAGLI.durum, toplamBildirim: 14 } })));
    await ilerlet(DAKIKA);
    expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 14');
  });

  it.each([
    ['403 (yetki geri alındı)', 403],
    ['404 (uç kaldırıldı)', 404],
  ])('tazeleme turunda %s → şerit GİZLENİR (eldeki "bağlı" artık doğrulanamıyor)', async (_ad, kod) => {
    await ciz();
    expect(screen.getByRole('status')).toBeTruthy();
    sahteFetch.mockImplementation(() => Promise.resolve(yanit({ success: false }, kod)));
    await ilerlet(DAKIKA);
    expect(screen.queryByRole('status')).toBeNull();
    expect(satirlar()).toHaveLength(4);
  });

  it('sekme GİZLİYKEN yoklanmaz; yeniden görünür olunca dakikayı beklemeden HEMEN okunur', async () => {
    await ciz();
    gorunurluk('hidden');
    await gorunurlukOlayi();
    await ilerlet(5 * DAKIKA);
    expect(sahteFetch).toHaveBeenCalledTimes(1);          // gizliyken ne olay ne zamanlayıcı istek atar
    sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: { ...BAGLI.durum, toplamBildirim: 20 } })));
    gorunurluk('visible');
    await gorunurlukOlayi();
    expect(sahteFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 20');
  });

  describe('istek sırası — yanıtlar atıldıkları sırayla DÖNMEYEBİLİR', () => {
    const YENI = { ...BAGLI, durum: { ...BAGLI.durum, toplamBildirim: 13, sonSonuc: 'hata', sonHata: 'Sipariş yazılamadı', sonHataZamani: '2026-10-02T09:20:00.000Z' } };
    /** Yanıtı testin elinde tutulan istek: `coz` çağrılana kadar askıda kalır (yavaş dönüş yolu). */
    const askidaIstek = () => {
      let coz: (r: Response) => void = () => {};
      sahteFetch.mockImplementationOnce(() => new Promise<Response>(c => { coz = c; }));
      return { don: async (r: Response) => { await act(async () => { coz(r); }); await bekle(); } };
    };

    it.each([
      ['eski durum (12, hata yok)', () => yanit(BAGLI)],
      ['403', () => yanit({ success: false }, 403)],
    ])('dakikalık turun yanıtı, sekme görünür olunca atılan isteğin yanıtından SONRA dönerse (%s) yeni durumu EZMEZ', async (_ad, eskiYanit) => {
      await ciz();
      const a = askidaIstek();                                   // A: dakikalık tur — yanıtı gecikiyor
      await ilerlet(DAKIKA);
      expect(sahteFetch).toHaveBeenCalledTimes(2);
      sahteFetch.mockImplementationOnce(() => Promise.resolve(yanit(YENI)));
      await gorunurlukOlayi();                                   // B: sekme görünür oldu — hemen döndü
      expect(sahteFetch).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 13');
      await a.don(eskiYanit());                                  // A şimdi döndü: B'den ÖNCE okunmuş durum
      const serit = screen.getByRole('status', { name: 'Mağaza bağlantısı' });
      expect(serit.textContent).toContain('Toplam bildirim: 13');
      expect(serit.textContent).toContain('Sipariş yazılamadı');
      // Sıra denetimi kalıcı kilit değil: bir sonraki tur yine yazar.
      sahteFetch.mockImplementation(() => Promise.resolve(yanit({ ...BAGLI, durum: { ...BAGLI.durum, toplamBildirim: 14 } })));
      await ilerlet(DAKIKA);
      expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 14');
    });

    it('yanıtlar SIRAYLA dönerse ikisi de yazılır (eski önce, yeni sonra — son söz yeninin)', async () => {
      await ciz();
      const a = askidaIstek();
      await ilerlet(DAKIKA);
      const b = askidaIstek();
      await gorunurlukOlayi();
      await a.don(yanit({ ...BAGLI, durum: { ...BAGLI.durum, toplamBildirim: 13 } }));
      expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 13');
      await b.don(yanit({ ...BAGLI, durum: { ...BAGLI.durum, toplamBildirim: 14 } }));
      expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 14');
    });

    it('EN SON istek ağ hatasıyla düşerse ondan önce atılmış geçerli yanıt yine yazılır (ölçüt «en son atılan» değil «yazılandan eski»)', async () => {
      await ciz();
      const a = askidaIstek();
      await ilerlet(DAKIKA);
      sahteFetch.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')));
      await gorunurlukOlayi();                                   // B düştü: eldeki durum (12) korunur
      expect(sahteFetch).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 12');
      await a.don(yanit({ ...BAGLI, durum: { ...BAGLI.durum, toplamBildirim: 13 } }));
      expect(screen.getByRole('status').textContent).toContain('Toplam bildirim: 13');
    });
  });

  it('temizlik: sayfa kapanınca zamanlayıcı da görünürlük dinleyicisi de kalkar (istek atılmaz)', async () => {
    const { unmount } = await ciz();
    unmount();
    await act(async () => { vi.advanceTimersByTime(3 * DAKIKA); document.dispatchEvent(new Event('visibilitychange')); });
    expect(sahteFetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sipariş sayısı değişince yine hemen okunur ve eski zamanlayıcı YENİSİYLE değişir (çift yoklama birikmez)', async () => {
    const { rerender, onSiparisAc } = await ciz();
    rerender(<OnlineSiparislerPage orders={[...SIPARISLER, siparis({ id: 'm5', shopifyOrderId: '#1005' })]} currentLanguage="tr" onSiparisAc={onSiparisAc} />);
    await bekle();
    expect(sahteFetch).toHaveBeenCalledTimes(2);
    await ilerlet(DAKIKA);
    expect(sahteFetch).toHaveBeenCalledTimes(3);          // 4 olsaydı eski zamanlayıcı temizlenmemiş demekti
  });
});

describe('"Bugün" kutusu — gün dönümü (`orders` DEĞİŞMEDEN)', () => {
  // Yerel saatle kurulur (gün anahtarı yereldir): test hangi saat diliminde koşarsa koşsun 1 Ekim 23:30'da başlar.
  const AKSAM = new Date(2026, 9, 1, 23, 30, 0);
  const BUGUNKU = [siparis({ id: 'g1', shopifyOrderId: '#5001', createdAt: new Date(2026, 9, 1, 10, 0, 0).toISOString() })];
  /** Kutunun DEĞER satırı: yalnız rakamdan oluşan tek metin (başlık ve alt satırda rakam yok). */
  const bugunSayisi = () => within(kutu('Bugün')).getByText(/^\d+$/).textContent;

  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime(AKSAM); });
  afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(document, 'visibilityState'); });

  it('gece yarısı geçince dakikalık yoklama günü çevirir: 1 → 0 (aynı `orders` dizisiyle)', async () => {
    await ciz({ orders: BUGUNKU });
    expect(bugunSayisi()).toBe('1');
    await ilerlet(29 * DAKIKA);                            // 23:59 — hâlâ aynı gün
    expect(bugunSayisi()).toBe('1');
    await ilerlet(2 * DAKIKA);                             // 00:01 — ertesi gün
    expect(bugunSayisi()).toBe('0');
    expect(satirlar()).toHaveLength(1);                    // sipariş listede duruyor; yalnız "bugün" sayısı değişti
  });

  it('arka planda bekleyen sekme (zamanlayıcı koşmadı) öne gelince günü HEMEN çevirir', async () => {
    await ciz({ orders: BUGUNKU });
    expect(bugunSayisi()).toBe('1');
    vi.setSystemTime(new Date(2026, 9, 2, 8, 30, 0));      // saat ilerledi ama aralık zamanlayıcısı tetiklenmedi
    expect(bugunSayisi()).toBe('1');
    await gorunurlukOlayi();
    expect(bugunSayisi()).toBe('0');
  });

  it('temizlik: sayfa kapanınca gün yoklaması da durur', async () => {
    const { unmount } = await ciz({ orders: BUGUNKU });
    expect(vi.getTimerCount()).toBe(2);                    // gün yoklaması + bağlantı şeridi
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
