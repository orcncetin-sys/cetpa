/**
 * PurchasingModule.rol.test.tsx — Satın Alma'daki «Mikro'da ara» kutusu (şartname `.wf/SARTNAME-mikro-cari-arama.md` C8, § 7 H3 d /
 * H8 / H9 / H13). Karar turunda (2026-10-11, K1 / H3) kutu HİÇBİR rolde çizilmiyordu: çağırdığı `cari/listesi` ucu sonuç
 * döndürmüyor, her aramada 200 cariye kadar müşteri havuzuna yazıyordu. Kutu salt okuyan `POST /api/mikro/cari/ara` ucuyla geri
 * geldi; bu dosyanın «hiçbir rolde çizilmez» testi rol tablosuna göre BİLEREK yeniden yazıldı (H3 d).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Kutu YALNIZ rol arama ucunun kapısından geçer VE `suppliers` yazarsa çizilir: Yönetici, Müdür, Satın Alma. Muhasebe uca
 *      geçer ama tedarikçi yazamaz, Lojistik uca geçmez — ikisinde de kutu yok, istek yok (İ3). Tablo ELLE yazılır.
 *   2. Arama gerçek sarmalayıcıdan (`araMikroCari`) gider; iki karakterden kısa metinde «Ara» pasif, istek yok.
 *   3. Sonuç / boş sonuç / hata / «ilk 20» metinleri; ekranda `undefined` yok; doğrulama 400'ü sunucu iletisiyle.
 *   4. İçe aktarma mükerrer açmaz: BÜYÜK harfli Mikro unvanı karışık harfli kayıtla `isimAnahtari` üzerinden eşleşir; var olan
 *      kayıtta yalnız boş alan dolar; Mikro'da boş alan `''` olarak yazılmaz.
 *   5. Ekranın geri kalanı bozulmadı: kayıtlı tedarikçi seçilir, «Yeni tedarikçi oluştur» çalışır.
 *   6. İnceleme 1: ad eşleşmesi yalnız kimliği ÇELİŞMEYEN kayıtta (farklı VKN / başka cari bağı → yeni tedarikçi); «Mikro'da ara» ve
 *      sonuç düğmeleri girdinin odağını almaz (hızlı yanıt liste kapanınca silinmez); uçuştaki yanıt sıfırlanmış kutuya yazılmaz.
 *   7. İnceleme 2 (İ2-1): aynı adlı iki tedarikçi varken sipariş düzenleme KAYITLI `supplierId`'yi korur (iki sırada da); ad yalnız
 *      bağsız eski siparişte ve TEK eşleşmede; tam ad yazımı birden çok eşleşmede hiçbirini seçmez, ikisi VKN'leriyle listede kalır.
 *   8. İnceleme 2 (İ2-2): klavye yolu — Tab ile «Mikro'da ara»ya ve sonuç düğmelerine ulaşılır (liste kapanmaz); girdide Enter arar.
 *   9. İnceleme 3 (İ3-1): tam ad TEK kayda eşleşince (hangi harf büyüklüğüyle yazılırsa yazılsın) yeşil onay görünür ve sipariş o
 *      kaydın `supplierId` / `mikroCariKod`'uyla yazılır (yeni sipariş ve düzenleme); birden çok eşleşmede bağ yok.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PurchasingModule from './PurchasingModule';
import { useAppStore } from '../store/appStore';
import { UserRole, type InventoryItem } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { addDoc, updateDoc, setDoc } from '../lib/dbClient';
import * as mikroServisi from '../services/mikroService';
import { sifirla, koleksiyonAyarla } from '../hooks/useArkaPlanIsi.testDuzenegi';

vi.mock('../lib/dbClient', async () => {
  const sahte = (await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi;
  return {
    ...sahte,
    // Tek bağımsız değişkenli `doc(collection(...))` (yeni sipariş kimliği — numara `PO-<id>`'den üretilir) sabit kimlik alır.
    doc: (dbVeyaRef: unknown, coll?: string, id?: string) => coll === undefined
      ? { type: 'doc' as const, coll: 'purchaseOrders', id: 'po-yeni-0001', path: 'purchaseOrders/po-yeni-0001' }
      : sahte.doc(dbVeyaRef, coll, id ?? ''),
    addDoc: vi.fn(() => Promise.resolve({ id: 'yeni-tedarikci' })),
    updateDoc: vi.fn(() => Promise.resolve()),
    setDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    serverTimestamp: vi.fn(() => 'şimdi'),
    incrementField: vi.fn((n: number) => n),
  };
});
// Arama sarmalayıcısı (`araMikroCari`) GERÇEK: istek `fetch` sahtesine düşer, gövdesi ve sayısı ölçülür. Tedarikçiyi Mikro'ya
// gönderen ve eski `cari/listesi` sarmalayıcıları sahte (çağrılırlarsa burada görülür).
vi.mock('../services/mikroService', async (asil) => ({
  ...(await asil<typeof import('../services/mikroService')>()),
  pullCariFromMikro: vi.fn(() => Promise.resolve({ success: true })),
  syncSupplierToMikro: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock('./MikroPushButton', () => ({ default: () => null }));

const eskiListeCagrisi = vi.mocked(mikroServisi.pullCariFromMikro);
const tedarikciGonder = vi.mocked(mikroServisi.syncSupplierToMikro);
const yaz = vi.mocked(addDoc);
const guncelle = vi.mocked(updateDoc);
const olustur = vi.mocked(setDoc);
const ROLLER = Object.values(UserRole);
/** Kutuyu GÖREN roller — ELLE (H9): arama kapısı (`leads` okuma) ∩ `suppliers` yazma. Muhasebe (uca geçer, tedarikçi yazamaz) ve
 *  Lojistik (uca geçmez) burada YOK. */
const KUTUYU_GOREN: UserRole[] = [UserRole.Admin, UserRole.Manager, UserRole.Purchasing];

const jsonYanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });
/** `/api/mikro/cari/ara` yanıtı — sınama başına kurulur. Söz (Promise) dönerse yanıt sınama çözene kadar UÇUŞTA kalır. */
let aramaYaniti: () => Response | Promise<Response> = () => jsonYanit({ success: true, data: [], sinirli: false });
const agIstegi = vi.fn((girdi: RequestInfo | URL, _init?: RequestInit) => {
  const yol = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.pathname : girdi.url;
  return Promise.resolve(yol === '/api/mikro/cari/ara' ? aramaYaniti() : jsonYanit({}));
});
const aramaIstekleri = () => agIstegi.mock.calls.filter(c => String(c[0]).startsWith('/api/mikro/cari/ara'));
const mikroIstekleri = () => agIstegi.mock.calls.filter(c => String(c[0]).startsWith('/api/mikro/'));
const bekle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

const VARSAYILAN_KAYITLAR = [{ id: 's1', veri: { name: 'Özkan Hırdavat', mikroCariKod: '320.01.007' } as Record<string, unknown> }];
/** Sipariş penceresini açar (düşük stok ön dolgusu pencereyi kendiliğinden açar) ve tedarikçi alanına yazar. */
async function tedarikciYaz(rol: UserRole, metin: string, kayitlar = VARSAYILAN_KAYITLAR, envanter: InventoryItem[] = []): Promise<HTMLInputElement> {
  koleksiyonAyarla('suppliers', kayitlar);
  useAppStore.setState({ userRole: rol });
  render(<PurchasingModule currentLanguage="tr" isAuthenticated userRole={rol} inventory={envanter} orders={[]} prefillProduct={{ name: 'Çimento', sku: 'CMT-1' }} />);
  await bekle();
  const alan = screen.getByPlaceholderText('Tedarikçi adı girin veya arayın...') as HTMLInputElement;
  fireEvent.focus(alan);
  fireEvent.change(alan, { target: { value: metin } });
  await bekle();
  return alan;
}
const araDugmesi = (metin: string): HTMLButtonElement => screen.getByRole('button', { name: `Mikro'da "${metin}" ara` }) as HTMLButtonElement;
async function ara(metin: string): Promise<void> {
  fireEvent.click(araDugmesi(metin));
  await bekle();
}
const tedarikciAlani = (): HTMLInputElement => screen.getByPlaceholderText('Tedarikçi adı girin veya arayın...') as HTMLInputElement;
/** Tarayıcı modeli: `mousedown`'ın VARSAYILAN eylemi odağı tıklanan öğeye taşımaktır (girdi `blur` olur → `onBlur` 150 ms sonra
 *  listeyi kapatır). jsdom bunu kendiliğinden yapmaz; burada elle ve YALNIZ varsayılan engellenmediyse (`fireEvent` `false`
 *  döndürür = `preventDefault` çağrıldı). Koşulsuz `blur` gerçek tarayıcıda olmayan bir olayı sınardı. */
function tarayiciTiklamasi(dugme: HTMLElement, odakli: HTMLElement): boolean {
  const varsayilanCalisti = fireEvent.mouseDown(dugme);
  if (varsayilanCalisti) fireEvent.blur(odakli);
  fireEvent.mouseUp(dugme);
  fireEvent.click(dugme);
  return varsayilanCalisti;
}
const msBekle = async (ms: number) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };

beforeEach(() => {
  sifirla();
  eskiListeCagrisi.mockClear();
  tedarikciGonder.mockClear();
  yaz.mockClear();
  guncelle.mockClear();
  olustur.mockClear();
  agIstegi.mockClear();
  aramaYaniti = () => jsonYanit({ success: true, data: [], sinirli: false });
  vi.stubGlobal('fetch', agIstegi);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({ userRole: UserRole.Sales });
});

describe("PurchasingModule — «Mikro'da ara» kutusu rol tablosuna göre (H3 d / H9)", () => {
  it('rol listesi rbac ile aynı küme (test rollerin TAMAMINI dolaşıyor)', () => {
    expect([...ROLLER].sort()).toEqual([...APP_ROLES].sort());
  });

  it.each(ROLLER)('%s — kutu yalnız Yönetici / Müdür / Satın Alma\'da; öbür rollerde «Mikro\'da … ara» yok, istek yok', async rol => {
    await tedarikciYaz(rol, 'Özkan');
    // Açılır liste AÇIK (kutu gizlendiği için değil, liste kapalı olduğu için geçen bir test olmasın).
    expect(screen.getByText('Kayıtlı tedarikçiler')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni tedarikçi oluştur: "Özkan"' })).toBeInTheDocument();
    if (KUTUYU_GOREN.includes(rol)) {
      expect(araDugmesi('Özkan')).toBeEnabled();
    } else {
      expect(screen.queryByText(/Mikro'da/)).toBeNull();
      expect(screen.queryByText(/Mikro sonuçları/)).toBeNull();
    }
    // Kutuyu gören rolde de düğmeye basılmadan istek YOK (tuşa basışta aranmaz — C6).
    expect(mikroIstekleri()).toEqual([]);
    expect(eskiListeCagrisi).not.toHaveBeenCalled();
  });
});

describe('PurchasingModule — arama akışı (Satın Alma)', () => {
  it('tek karakterde «Ara» pasif, altında «En az iki karakter yazın.»; tıklansa da istek yok', async () => {
    await tedarikciYaz(UserRole.Purchasing, 'Ö');
    expect(araDugmesi('Ö')).toBeDisabled();
    expect(screen.getByText('En az iki karakter yazın.')).toBeInTheDocument();
    fireEvent.click(araDugmesi('Ö'));
    await bekle();
    expect(aramaIstekleri()).toEqual([]);
  });

  it('«Ara» gerçek sarmalayıcıdan `{ metin }` gövdesiyle gider; sonuçlar çizilir; «ilk 20» satırı `sinirli`de', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: true, data: [
      { cari_kod: '320.01.010', cari_unvan1: 'ÖZKAN YAPI MARKET', cari_vdaire_no: '1234567890' },
      { cari_kod: '320.01.011', cari_unvan1: 'ÖZKANLAR BOYA' },
    ] });
    await tedarikciYaz(UserRole.Purchasing, '  Özkan ');
    await ara('Özkan');
    expect(aramaIstekleri()).toHaveLength(1);
    const init = aramaIstekleri()[0][1];
    expect([init?.method, JSON.parse(String(init?.body))]).toEqual(['POST', { metin: 'Özkan' }]);
    expect(screen.getByText('Mikro sonuçları')).toBeInTheDocument();
    expect(screen.getByText('ÖZKAN YAPI MARKET')).toBeInTheDocument();
    expect(screen.getByText('(320.01.010 · VKN 1234567890)')).toBeInTheDocument();
    expect(screen.getByText('ÖZKANLAR BOYA')).toBeInTheDocument();
    expect(screen.getByText('İlk 20 sonuç gösteriliyor, aramayı daraltın.')).toBeInTheDocument();
  });

  it('boş sonuç: «Mikro\'da bulunamadı.»; «ilk 20» satırı yok', async () => {
    await tedarikciYaz(UserRole.Purchasing, 'Özkan');
    await ara('Özkan');
    expect(screen.getByText("Mikro'da bulunamadı.")).toBeInTheDocument();
    expect(screen.queryByText(/İlk 20 sonuç/)).toBeNull();
  });

  it.each([
    ['Mikro reddi (502, iletiyle)', () => jsonYanit({ success: false, error: "Invalid column name 'cari_unvan2'." }, 502), "Mikro'ya ulaşılamadı: Invalid column name 'cari_unvan2'."],
    ['iletisiz hata (502)', () => jsonYanit({ success: false }, 502), "Mikro'ya ulaşılamadı: HTTP 502"],
    ['JSON olmayan yanıt (504)', () => new Response('Gateway Timeout', { status: 504 }), "Mikro'ya ulaşılamadı: HTTP 504"],
    ['yapılandırılmamış (503)', () => jsonYanit({ success: false, notConfigured: true }, 503), 'Mikro bağlantısı yapılandırılmamış.'],
    ['gövde doğrulaması (400) — sunucu iletisi, önek yok', () => jsonYanit({ success: false, error: 'Arama metni en çok 100 karakter olabilir.' }, 400), 'Arama metni en çok 100 karakter olabilir.'],
  ])('hata görünür, sessiz değil: %s', async (_ad, yanit, metin) => {
    aramaYaniti = yanit;
    await tedarikciYaz(UserRole.Purchasing, 'Özkan');
    await ara('Özkan');
    expect(screen.getByRole('alert')).toHaveTextContent(metin);
    expect(screen.getByRole('alert').textContent).toBe(metin);
    expect(document.body.textContent).not.toContain('undefined');
    expect(screen.queryByText('Mikro sonuçları')).toBeNull();
    // Yeniden denenebilir: «Ara» düğmesi duruyor.
    expect(araDugmesi('Özkan')).toBeEnabled();
  });
});

describe('PurchasingModule — odak ve uçuştaki yanıt (inceleme 1)', () => {
  it('«Mikro\'da ara» odağı girdiden ALMAZ: hızlı 503 iletisi girdinin onBlur zamanlayıcısından (150 ms) sonra da görünür', async () => {
    aramaYaniti = () => jsonYanit({ success: false, notConfigured: true }, 503);
    const alan = await tedarikciYaz(UserRole.Purchasing, 'Özkan');
    const varsayilanCalisti = tarayiciTiklamasi(araDugmesi('Özkan'), alan);
    await bekle();
    await msBekle(250);
    expect(screen.getByRole('alert').textContent).toBe('Mikro bağlantısı yapılandırılmamış.');
    expect(varsayilanCalisti).toBe(false);                    // mousedown varsayılanı (odak taşıma) engellendi
    expect(aramaIstekleri()).toHaveLength(1);
  });

  it('Mikro sonuç düğmesi de odağı almaz: kayıt hatası («Tedarikçi kaydedilemedi.») 250 ms sonra da görünür', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '320.01.095', cari_unvan1: 'TAŞ YAPI' }] });
    yaz.mockImplementationOnce(() => Promise.reject(new Error('yazılamadı')));
    const alan = await tedarikciYaz(UserRole.Purchasing, 'taş');
    await ara('taş');
    const hataGunlugu = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(tarayiciTiklamasi(screen.getByRole('button', { name: /TAŞ YAPI/ }), alan)).toBe(false);
      await bekle();
      await msBekle(250);
    } finally { hataGunlugu.mockRestore(); }
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe('Tedarikçi kaydedilemedi.');
  });

  it('uçuştaki «kaya» yanıtı metin «kayalar» olduktan sonra gelirse YAZILMAZ: «Mikro sonuçları» yok, «Ara» takılı kalmaz', async () => {
    let coz: (r: Response) => void = () => {};
    aramaYaniti = () => new Promise<Response>(r => { coz = r; });
    await tedarikciYaz(UserRole.Purchasing, 'kaya');
    await ara('kaya');
    expect(screen.getByRole('button', { name: "Mikro'da aranıyor…" })).toBeDisabled();
    fireEvent.change(tedarikciAlani(), { target: { value: 'kayalar' } });
    await bekle();
    await act(async () => { coz(jsonYanit({ success: true, sinirli: true, data: [{ cari_kod: '320.01.090', cari_unvan1: 'KAYA YAPI' }] })); });
    await bekle();
    expect(aramaIstekleri()).toHaveLength(1);
    expect(screen.queryByText('Mikro sonuçları')).toBeNull();
    expect(screen.queryByText('KAYA YAPI')).toBeNull();
    expect(screen.queryByText("Mikro'da bulunamadı.")).toBeNull();
    expect(screen.queryByText(/İlk 20 sonuç/)).toBeNull();
    expect(araDugmesi('kayalar')).toBeEnabled();              // yeni metinle yeniden aranabilir
  });

  it('eski aramanın geç yanıtı, YENİ arama uçuştayken «aranıyor» durumunu bitirmez (düğme yeniden açılmaz, çift istek yok); yeni yanıt yazılır', async () => {
    const cozuculer: Array<(r: Response) => void> = [];
    aramaYaniti = () => new Promise<Response>(r => { cozuculer.push(r); });
    await tedarikciYaz(UserRole.Purchasing, 'kaya');
    await ara('kaya');
    fireEvent.change(tedarikciAlani(), { target: { value: 'kayalar' } });
    await bekle();
    await ara('kayalar');
    expect(aramaIstekleri()).toHaveLength(2);
    await act(async () => { cozuculer[0](jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '320.01.090', cari_unvan1: 'KAYA YAPI' }] })); });
    await bekle();
    expect(screen.getByRole('button', { name: "Mikro'da aranıyor…" })).toBeDisabled();   // ikinci arama hâlâ sürüyor
    expect(screen.queryByText('KAYA YAPI')).toBeNull();
    await act(async () => { cozuculer[1](jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '320.01.091', cari_unvan1: 'KAYALAR BOYA' }] })); });
    await bekle();
    expect(screen.getByText('Mikro sonuçları')).toBeInTheDocument();
    expect(screen.getByText('KAYALAR BOYA')).toBeInTheDocument();
    expect(screen.queryByText('KAYA YAPI')).toBeNull();
  });

  it('uçuştaki hata yanıtı da yazılmaz (kayıtlı tedarikçi seçildikten sonra gelen 503 iletisi görünmez)', async () => {
    let coz: (r: Response) => void = () => {};
    aramaYaniti = () => new Promise<Response>(r => { coz = r; });
    await tedarikciYaz(UserRole.Purchasing, 'Özkan');
    await ara('Özkan');
    fireEvent.click(screen.getByRole('button', { name: /Özkan Hırdavat/ }));
    await bekle();
    await act(async () => { coz(jsonYanit({ success: false, notConfigured: true }, 503)); });
    await bekle();
    expect(tedarikciAlani().value).toBe('Özkan Hırdavat');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Kayıtlı tedarikçiler')).toBeNull();   // seçimle kapanan liste bayat yanıtla yeniden AÇILMAZ
  });
});

describe('PurchasingModule — içe aktarma mükerrer açmaz (C8 / H13)', () => {
  it('BÜYÜK harfli Mikro unvanı karışık harfli kayıtla eşleşir: `addDoc` YOK; yalnız boş alanlar dolar, Mikro\'da boş alan yazılmaz', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '320.01.050', cari_unvan1: 'İSTANBUL YAPI', cari_CepTel: '05320000000' }] });
    await tedarikciYaz(UserRole.Purchasing, 'istanbul', [{ id: 'yerel-1', veri: { name: 'İstanbul Yapı', email: 'satis@istanbulyapi.example' } }]);
    await ara('istanbul');
    fireEvent.click(screen.getByRole('button', { name: /İSTANBUL YAPI/ }));
    await bekle();
    expect(yaz).not.toHaveBeenCalled();
    expect(guncelle).toHaveBeenCalledTimes(1);
    // E-posta zaten dolu (korunur); VKN Mikro'da yok ('' yazılmaz); telefon ve cari kod boştu (dolar).
    expect(guncelle.mock.calls[0][1]).toEqual({ phone: '05320000000', mikroCariKod: '320.01.050' });
    expect(tedarikciAlani().value).toBe('İstanbul Yapı');
  });

  it('eşleşme sırası VKN → cari kod → ad: VKN tutan kayıt adı tutan kayıttan ÖNCE seçilir; başka cariye bağlı kaydın bağı değişmez', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '320.01.060', cari_unvan1: 'YILDIZ BOYA', cari_vdaire_no: '1112223334' }] });
    await tedarikciYaz(UserRole.Purchasing, 'yıldız', [
      { id: 'adi-tutan', veri: { name: 'Yıldız Boya' } },
      { id: 'vkn-tutan', veri: { name: 'Yıldız Boya Sanayi', taxNo: '111 222 33-34', mikroCariKod: '320.99.999' } },
    ]);
    await ara('yıldız');
    fireEvent.click(screen.getByRole('button', { name: /YILDIZ BOYA/ }));
    await bekle();
    expect(yaz).not.toHaveBeenCalled();
    // VKN tutan kayıtta doldurulacak boş alan yok (VKN dolu, cari kod başka cariye bağlı — üzerine YAZILMAZ): yazım hiç yapılmaz.
    expect(guncelle).not.toHaveBeenCalled();
    expect(tedarikciAlani().value).toBe('Yıldız Boya Sanayi');
  });

  it('eşleşme yoksa yeni tedarikçi: ad + cari kod + Mikro\'da DOLU alanlar; boş alan için `\'\'` yazılmaz', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '320.01.070', cari_unvan1: 'ŞİRİN HIRDAVAT', cari_EMail: 'bilgi@sirin.example' }] });
    await tedarikciYaz(UserRole.Purchasing, 'şirin');
    await ara('şirin');
    fireEvent.click(screen.getByRole('button', { name: /ŞİRİN HIRDAVAT/ }));
    await bekle();
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(yaz.mock.calls[0][1]).toEqual({ name: 'ŞİRİN HIRDAVAT', mikroCariKod: '320.01.070', email: 'bilgi@sirin.example', createdAt: 'şimdi' });
    expect(tedarikciGonder).not.toHaveBeenCalled();     // Mikro'da zaten var: geri gönderilmez
    expect(tedarikciAlani().value).toBe('ŞİRİN HIRDAVAT');
  });

  it('yeni tedarikçide e-posta Mikro\'da BOŞSA alan hiç yazılmaz (`email: \'\'` yok); telefon ve VKN doluysa yazılır', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '320.01.075', cari_unvan1: 'ÇAĞLAR DEMİR', cari_CepTel: '05340000000', cari_vdaire_no: '4445556667' }] });
    await tedarikciYaz(UserRole.Purchasing, 'çağlar');
    await ara('çağlar');
    fireEvent.click(screen.getByRole('button', { name: /ÇAĞLAR DEMİR/ }));
    await bekle();
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(yaz.mock.calls[0][1]).toEqual({ name: 'ÇAĞLAR DEMİR', mikroCariKod: '320.01.075', phone: '05340000000', taxNo: '4445556667', createdAt: 'şimdi' });
  });

  it('var olan tedarikçinin DOLU alanı Mikro\'daki farklı değerle EZİLMEZ (yalnız boş alan dolar — C8)', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [{
      cari_kod: '320.01.080', cari_unvan1: 'KAYA YAPI', cari_EMail: 'yeni@kaya.example', cari_CepTel: '05330000000', cari_vdaire_no: '999 888 77-76',
    }] });
    await tedarikciYaz(UserRole.Purchasing, 'kaya', [
      { id: 'dolu', veri: { name: 'Kaya Yapı', email: 'eski@kaya.example', phone: '02120000000', taxNo: '9998887776' } },
    ]);
    await ara('kaya');
    fireEvent.click(screen.getByRole('button', { name: /KAYA YAPI/ }));
    await bekle();
    expect(yaz).not.toHaveBeenCalled();
    // E-posta, telefon ve VKN doluydu (korunur); yalnız boş olan cari kod dolar.
    expect(guncelle).toHaveBeenCalledTimes(1);
    expect(guncelle.mock.calls[0][1]).toEqual({ mikroCariKod: '320.01.080' });
    expect(tedarikciAlani().value).toBe('Kaya Yapı');
  });
});

describe('PurchasingModule — ad eşleşmesi yalnız kimliği ÇELİŞMEYEN kayıtta (inceleme 1, kullanıcı kararı)', () => {
  const KAYA = { cari_kod: '320.01.090', cari_unvan1: 'KAYA YAPI', cari_vdaire_no: '1111111111' };
  const kayayiIceAktar = async (kayit: Record<string, unknown>, cari: Record<string, unknown> = KAYA) => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [cari] });
    await tedarikciYaz(UserRole.Purchasing, 'kaya', [{ id: 'yerel-kaya', veri: kayit }]);
    await ara('kaya');
    fireEvent.click(screen.getByRole('button', { name: /KAYA YAPI/ }));
    await bekle();
  };

  it('D1 — aynı ad, FARKLI VKN: başka firmadır → `updateDoc` yok, YENİ tedarikçi (`addDoc` 1) Mikro kimliğiyle', async () => {
    await kayayiIceAktar({ name: 'Kaya Yapı', taxNo: '2222222222' });
    expect(guncelle).not.toHaveBeenCalled();
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(yaz.mock.calls[0][1]).toEqual({ name: 'KAYA YAPI', mikroCariKod: '320.01.090', taxNo: '1111111111', createdAt: 'şimdi' });
    expect(tedarikciAlani().value).toBe('KAYA YAPI');
  });

  it('D2 — aynı ad, BAŞKA cariye bağlı kayıt: başka firmadır → `updateDoc` yok, YENİ tedarikçi (`addDoc` 1)', async () => {
    await kayayiIceAktar({ name: 'Kaya Yapı', mikroCariKod: '320.05.005' });
    expect(guncelle).not.toHaveBeenCalled();
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(yaz.mock.calls[0][1]).toMatchObject({ name: 'KAYA YAPI', mikroCariKod: '320.01.090' });
  });

  it('kontrol: kaydın VKN\'si dolu ama Mikro kartında VKN YOK → çelişki yok, ad eşleşir (yalnız boş cari kod dolar)', async () => {
    await kayayiIceAktar({ name: 'Kaya Yapı', taxNo: '2222222222' }, { cari_kod: '320.01.090', cari_unvan1: 'KAYA YAPI' });
    expect(yaz).not.toHaveBeenCalled();
    expect(guncelle).toHaveBeenCalledTimes(1);
    expect(guncelle.mock.calls[0][1]).toEqual({ mikroCariKod: '320.01.090' });
  });

  it('kontrol: VKN aynı sayılar farklı biçimde (`111 111 11-11`) → VKN dalı eşleşir, yeni kayıt açılmaz', async () => {
    await kayayiIceAktar({ name: 'Kaya Yapı', taxNo: '111 111 11-11' });
    expect(yaz).not.toHaveBeenCalled();
    expect(guncelle.mock.calls[0][1]).toEqual({ mikroCariKod: '320.01.090' });
  });
});

describe('PurchasingModule — tedarikçi seçimi Mikro araması olmadan da çalışır', () => {
  it('kayıtlı tedarikçi listeden seçilir', async () => {
    const alan = await tedarikciYaz(UserRole.Purchasing, 'Özkan');
    fireEvent.click(screen.getByRole('button', { name: /Özkan Hırdavat/ }));
    await bekle();
    expect(alan.value).toBe('Özkan Hırdavat');
    expect(screen.queryByText('Kayıtlı tedarikçiler')).toBeNull();   // liste kapandı
    expect(yaz).not.toHaveBeenCalled();
  });

  it('«Yeni tedarikçi oluştur» tedarikçiyi yazar ve Mikro cari kaydını dener (bu yol değişmedi)', async () => {
    await tedarikciYaz(UserRole.Purchasing, 'Yıldız Boya');
    fireEvent.click(screen.getByRole('button', { name: 'Yeni tedarikçi oluştur: "Yıldız Boya"' }));
    await bekle();
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(yaz.mock.calls[0][1]).toMatchObject({ name: 'Yıldız Boya' });
    expect(tedarikciGonder).toHaveBeenCalledWith({ name: 'Yıldız Boya' }, 'yeni-tedarikci');
    expect(aramaIstekleri()).toEqual([]);
    expect(eskiListeCagrisi).not.toHaveBeenCalled();
  });
});

// ── İnceleme 2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CIMENTO: InventoryItem = { id: 'p-cimento', sku: 'CMT-1', name: 'Çimento', stockLevel: 5, lowStockThreshold: 1, prices: { Retail: 100 }, costPrice: 60 };
/** Girdinin yanındaki yeşil onay simgesi = siparişe yazılacak bağ (`seciliTedarikciId`) dolu (ekranda «seçildi» göstergesi). */
const seciliGosterge = (): Element | null => tedarikciAlani().parentElement?.querySelector('svg') ?? null;
/** Sipariş penceresi düzenleme için: `purchaseOrders` + `suppliers` dolu, satırdaki «Düzenle» tıklanır. */
async function siparisiDuzenle(siparis: Record<string, unknown>, kayitlar: { id: string; veri: Record<string, unknown> }[]): Promise<void> {
  koleksiyonAyarla('suppliers', kayitlar);
  koleksiyonAyarla('purchaseOrders', [{ id: 'po-1', veri: {
    orderNumber: 'PO-0001', status: 'Taslak', expectedDate: '2026-10-20', createdAt: '2026-10-17',
    items: [{ id: 'p-cimento', name: 'Çimento', sku: 'CMT-1', quantity: 2, purchasePrice: 60 }], ...siparis,
  } }]);
  useAppStore.setState({ userRole: UserRole.Purchasing });
  render(<PurchasingModule currentLanguage="tr" isAuthenticated userRole={UserRole.Purchasing} inventory={[]} orders={[]} />);
  await bekle();
  fireEvent.click(screen.getByTitle('Düzenle'));
  await bekle();
}
/** «Güncelle» → `purchaseOrders/po-1` yazımının gövdesi. */
async function guncelleVeOku(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: 'Güncelle' }));
  await bekle();
  const cagri = guncelle.mock.calls.find(c => (c[0] as unknown as { path?: string }).path === 'purchaseOrders/po-1');
  expect(cagri, 'purchaseOrders/po-1 güncellenmedi').toBeDefined();
  return (cagri?.[1] ?? {}) as Record<string, unknown>;
}
/** Pencere envanterle açılır (ön dolgu «Çimento»yu arar), tedarikçi yazılır, kalem eklenir; `siparisiOlustur` `setDoc` gövdesini döndürür. */
async function envanterleSiparisAc(metin: string, kayitlar: { id: string; veri: Record<string, unknown> }[]): Promise<void> {
  await tedarikciYaz(UserRole.Purchasing, metin, kayitlar, [CIMENTO]);
  fireEvent.click(screen.getByRole('button', { name: /Çimento/ }));
  await bekle();
}
async function siparisiOlustur(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: 'Siparişi Oluştur' }));
  await bekle();
  expect(olustur).toHaveBeenCalledTimes(1);
  return (olustur.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
}

describe('PurchasingModule — sipariş düzenleme kayıtlı tedarikçi bağını korur (inceleme 2 — İ2-1)', () => {
  // İ1-3'ün bilerek açtığı ikili: aynı ad, farklı kimlik. Sıra iki yönde de sınanır — eski «ada göre ilk kayıt» kodu birinde
  // tesadüfen doğru kayda düşerdi.
  const ESKI = { id: 'kaya-eski', veri: { name: 'Kaya Yapı', taxNo: '2222222222' } };
  const YENI = { id: 'kaya-yeni', veri: { name: 'Kaya Yapı', taxNo: '1111111111', mikroCariKod: '320.01.090' } };
  const SIPARIS = { supplier: 'Kaya Yapı', supplierId: 'kaya-yeni', mikroCariKod: '320.01.090' };

  it.each([
    ['eski kayıt listede önce', [ESKI, YENI]],
    ['yeni kayıt listede önce', [YENI, ESKI]],
  ])('%s: «Güncelle» siparişin KENDİ supplierId / mikroCariKod\'unu yazar (öbür aynı adlı kayda geçmez)', async (_ad, kayitlar) => {
    await siparisiDuzenle(SIPARIS, kayitlar);
    expect(screen.getByText('Siparişi Düzenle')).toBeInTheDocument();
    expect(seciliGosterge()).not.toBeNull();
    const govde = await guncelleVeOku();
    expect([govde.supplierId, govde.mikroCariKod]).toEqual(['kaya-yeni', '320.01.090']);
  });

  it('bağı kayıtlı sipariş, bağlı kayıt listede YOKKEN de bağını korur: aynı adlı tek kayda geçmez, cari kodu silinmez', async () => {
    await siparisiDuzenle({ supplier: 'Kaya Yapı', supplierId: 'silinmis-kayit', mikroCariKod: '320.01.090' }, [ESKI]);
    const govde = await guncelleVeOku();
    expect([govde.supplierId, govde.mikroCariKod]).toEqual(['silinmis-kayit', '320.01.090']);
  });

  it('bağsız ESKİ sipariş: ad TEK kayda eşleşiyorsa o seçilir — `isimAnahtari` ile (BÜYÜK harfli ad karışık harfli kayıtla)', async () => {
    await siparisiDuzenle({ supplier: 'KAYA YAPI' }, [{ id: 'kaya-tek', veri: { name: 'Kaya Yapı', mikroCariKod: '320.01.091' } }]);
    const govde = await guncelleVeOku();
    expect([govde.supplierId, govde.mikroCariKod]).toEqual(['kaya-tek', '320.01.091']);
  });

  it('bağsız ESKİ sipariş: ad BİRDEN ÇOK kayda eşleşiyorsa hiçbiri seçilmez (bağ boş kalır, kullanıcı listeden seçer)', async () => {
    await siparisiDuzenle({ supplier: 'Kaya Yapı' }, [ESKI, YENI]);
    expect(seciliGosterge()).toBeNull();
    const govde = await guncelleVeOku();
    expect([govde.supplierId, govde.mikroCariKod]).toEqual([null, null]);
  });
});

describe('PurchasingModule — tam ad birden çok kayda eşleşince otomatik seçim yok (inceleme 2 — İ2-1)', () => {
  const IKILI = [
    { id: 'kaya-elle', veri: { name: 'Kaya Yapı', taxNo: '2222222222' } },
    { id: 'kaya-mikro', veri: { name: 'KAYA YAPI', taxNo: '1111111111', mikroCariKod: '320.01.090' } },
  ];

  it('elle açılan «Kaya Yapı» + Mikro\'dan gelen «KAYA YAPI»: tam ad yazılınca İKİSİ de VKN\'leriyle listede, hiçbiri seçili değil, yeni kopya düğmesi yok', async () => {
    await tedarikciYaz(UserRole.Purchasing, 'Kaya Yapı', IKILI);
    expect(screen.getByText('Kayıtlı tedarikçiler')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Kaya Yapı\s*·\s*VKN 2222222222/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^KAYA YAPI\s*·\s*VKN 1111111111/ })).toBeInTheDocument();
    expect(seciliGosterge()).toBeNull();
    expect(screen.queryByRole('button', { name: /Yeni tedarikçi oluştur/ })).toBeNull();
    expect(screen.getByText('Bu adla birden çok tedarikçi kayıtlı — VKN\'ye bakarak listeden seçin.')).toBeInTheDocument();
    expect(yaz).not.toHaveBeenCalled();
  });

  const envanterliAc = () => envanterleSiparisAc('Kaya Yapı', IKILI);

  it('seçim yapılmadan oluşturulan sipariş BAĞSIZ gider (`supplierId: null`) — ilk kayda kendiliğinden bağlanmaz', async () => {
    await envanterliAc();
    const govde = await siparisiOlustur();
    expect([govde.supplier, govde.supplierId, govde.mikroCariKod]).toEqual(['Kaya Yapı', null, null]);
  });

  it('listeden seçilen kayıt (Mikro\'dan gelen «KAYA YAPI») siparişe O kaydın bağıyla yazılır', async () => {
    await envanterliAc();
    fireEvent.click(screen.getByRole('button', { name: /^KAYA YAPI\s*·\s*VKN 1111111111/ }));
    await bekle();
    expect(seciliGosterge()).not.toBeNull();
    const govde = await siparisiOlustur();
    expect([govde.supplier, govde.supplierId, govde.mikroCariKod]).toEqual(['KAYA YAPI', 'kaya-mikro', '320.01.090']);
  });
});

describe('PurchasingModule — tam ad TEK kayda eşleşince sipariş o kayda bağlanır (inceleme 3 — İ3-1)', () => {
  // Hata: tam ad yazılınca liste kapanıyordu (tek eşleşme) ama `selectedSupplierId` boş kaldığı için sipariş `supplierId: null` ile
  // yazılıyordu; `isimAnahtari`'na geçiş bunu BÜYÜK / küçük harfli yazıma da yaydı. Üç yazım da AYNI tek kayda bağlanmalı.
  const TEK = [{ id: 'kaya-tek', veri: { name: 'Kaya Yapı', mikroCariKod: '320.01.091' } }];
  const IKILI = [
    { id: 'kaya-elle', veri: { name: 'Kaya Yapı', taxNo: '2222222222' } },
    { id: 'kaya-mikro', veri: { name: 'KAYA YAPI', taxNo: '1111111111', mikroCariKod: '320.01.090' } },
  ];
  const YAZIMLAR = ['KAYA YAPI', 'kaya yapı', 'Kaya Yapı'];

  it.each(YAZIMLAR)('«%s» → liste kapalı, yeşil onay görünür; setDoc [supplierId, mikroCariKod] = [kaya-tek, 320.01.091]', async metin => {
    await envanterleSiparisAc(metin, TEK);
    expect(screen.queryByText('Kayıtlı tedarikçiler')).toBeNull();   // liste kapandı (tek tam eşleşme)
    expect(seciliGosterge()).not.toBeNull();
    const govde = await siparisiOlustur();
    expect([govde.supplier, govde.supplierId, govde.mikroCariKod]).toEqual([metin, 'kaya-tek', '320.01.091']);
    expect(yaz).not.toHaveBeenCalled();                               // yeni tedarikçi açılmadı
  });

  it.each(YAZIMLAR)('«%s» iki aynı adlı kayıtta → yeşil onay YOK, sipariş bağsız (supplierId / mikroCariKod null)', async metin => {
    await envanterleSiparisAc(metin, IKILI);
    expect(seciliGosterge()).toBeNull();
    const govde = await siparisiOlustur();
    expect([govde.supplierId, govde.mikroCariKod]).toEqual([null, null]);
  });

  it('düzenlemede (form ortak) tedarikçi alanı tam adla yeniden yazılınca gösterge ve «Güncelle» AYNI tek kayda bağlar', async () => {
    await siparisiDuzenle({ supplier: 'Özkan Hırdavat', supplierId: 's1', mikroCariKod: '320.01.007' }, [
      { id: 's1', veri: { name: 'Özkan Hırdavat', mikroCariKod: '320.01.007' } }, ...TEK,
    ]);
    fireEvent.change(tedarikciAlani(), { target: { value: 'KAYA YAPI' } });
    await bekle();
    expect(seciliGosterge()).not.toBeNull();
    const govde = await guncelleVeOku();
    expect([govde.supplier, govde.supplierId, govde.mikroCariKod]).toEqual(['KAYA YAPI', 'kaya-tek', '320.01.091']);
  });
});

/** Tab benzetimi: belgede odaklanabilir SIRADAKİ öğeye gerçek `focus()`. jsdom `focusout`'u `relatedTarget` = yeni öğe ile yayar —
 *  tarayıcıda Tab'ın ürettiği olay dizisi (girdi → kutudaki düğme). */
function tab(): HTMLElement {
  const liste = Array.from(document.querySelectorAll<HTMLElement>(
    'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
  const sonraki = liste[liste.indexOf(document.activeElement as HTMLElement) + 1];
  expect(sonraki, 'Tab ile gidilecek öğe yok').toBeDefined();
  act(() => { sonraki.focus(); });
  return sonraki;
}

describe('PurchasingModule — klavye yolu (inceleme 2 — İ2-2)', () => {
  it('Tab ile odak «Mikro\'da ara»ya geçer; 200 ms sonra düğme DOM\'da, basılınca TAM 1 arama isteği', async () => {
    const alan = await tedarikciYaz(UserRole.Purchasing, 'Taş');   // kayıtlı eşleşme yok: girdiden sonraki ilk öğe «Mikro'da ara»
    act(() => { alan.focus(); });
    const odak = tab();
    expect(odak).toBe(araDugmesi('Taş'));
    await msBekle(200);
    expect(araDugmesi('Taş')).toBe(odak);                      // liste kapanmadı: düğme aynı öğe, DOM'da
    fireEvent.click(odak);                                     // klavyede Enter / Boşluk = click
    await bekle();
    expect(aramaIstekleri()).toHaveLength(1);
  });

  it('düğmeyle başlayan aramadan sonra odak girdiye döner; Tab sonuç düğmesine ulaşır, 200 ms sonra düğme duruyor ve içe aktarır', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '320.01.095', cari_unvan1: 'TAŞ YAPI' }] });
    const alan = await tedarikciYaz(UserRole.Purchasing, 'Taş');
    act(() => { alan.focus(); });
    fireEvent.click(tab());
    await bekle();
    expect(document.activeElement).toBe(alan);
    const sonuc = tab();
    expect(sonuc).toBe(screen.getByRole('button', { name: /TAŞ YAPI/ }));
    await msBekle(200);
    expect(screen.getByRole('button', { name: /TAŞ YAPI/ })).toBe(sonuc);
    fireEvent.click(sonuc);
    await bekle();
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(yaz.mock.calls[0][1]).toMatchObject({ name: 'TAŞ YAPI', mikroCariKod: '320.01.095' });
  });

  it('odak kutudan DIŞARI çıkınca (düğmeden de) liste 150 ms sonra kapanır', async () => {
    const alan = await tedarikciYaz(UserRole.Purchasing, 'Taş');
    act(() => { alan.focus(); });
    tab();                                                     // «Mikro'da ara»
    const tarih = document.querySelector<HTMLInputElement>('input[type="date"]');
    expect(tarih).not.toBeNull();
    act(() => { tarih?.focus(); });                            // kutu dışı: «Beklenen Tarih»
    await msBekle(200);
    expect(screen.queryByRole('button', { name: `Mikro'da "Taş" ara` })).toBeNull();
    expect(aramaIstekleri()).toEqual([]);
  });

  it('odak kutudan çıkıp 150 ms içinde GİRDİYE dönerse bekleyen kapatma iptal: liste açık kalır', async () => {
    const alan = await tedarikciYaz(UserRole.Purchasing, 'Taş');
    act(() => { alan.focus(); });
    act(() => { document.querySelector<HTMLInputElement>('input[type="date"]')?.focus(); });
    await msBekle(50);
    act(() => { alan.focus(); });
    await msBekle(200);
    expect(araDugmesi('Taş')).toBeEnabled();
  });

  it('girdide Enter TAM 1 arama isteği atar (varsayılan engellenir); sonuç gelince ikinci Enter yeni istek atmaz', async () => {
    const alan = await tedarikciYaz(UserRole.Purchasing, 'Taş');
    expect(fireEvent.keyDown(alan, { key: 'Enter' })).toBe(false);
    await bekle();
    expect(aramaIstekleri()).toHaveLength(1);
    expect(JSON.parse(String(aramaIstekleri()[0][1]?.body))).toEqual({ metin: 'Taş' });
    expect(screen.getByText("Mikro'da bulunamadı.")).toBeInTheDocument();
    fireEvent.keyDown(alan, { key: 'Enter' });
    await bekle();
    expect(aramaIstekleri()).toHaveLength(1);
  });

  it.each([
    ['tek karakter (Satın Alma)', UserRole.Purchasing, 'T'],
    ['kutuyu görmeyen rol (Muhasebe)', UserRole.Accounting, 'Taş'],
    ['tam ad TEK kayda eşleşiyor (liste kapalı)', UserRole.Purchasing, 'Özkan Hırdavat'],
  ])('Enter istek ATMAZ ve varsayılanı engellemez: %s', async (_ad, rol, metin) => {
    const alan = await tedarikciYaz(rol, metin);
    expect(fireEvent.keyDown(alan, { key: 'Enter' })).toBe(true);
    await bekle();
    expect(aramaIstekleri()).toEqual([]);
  });
});
