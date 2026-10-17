/**
 * yeniSurum.test.ts — «yeni sürüm var, yenile» denetimi: saf karar + zamanlama (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md`
 * T1, T4). Sahte zamanlayıcı; ağ yerine kaydeden küçük bir `getir`; `document` / `window` yerine küçük olay hedefleri.
 *
 * T4 (mutasyon): karşılaştırmayı ters çevirmek, kapatma hafızasını silmek bu dosyayı kırmızıya döndürür — hangi sınama hangi
 * mutasyonu yakaladığı yanında yazılı.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GORUNURLUK_EN_AZ_ARA_MS, SURUM_DENETIM_ARALIGI_MS, gezinmeTuruOku, gomuluSurumuOku, parcaAdresiniBul, seritDeposuOlustur,
  sunucuYanitiniAyikla, surumDenetimiBaslat, yeniSurumSeridiGerekli, type SeritDeposu,
} from './yeniSurum';
import { SURUM_META_ADI, SURUM_UCU, surumGecerli } from './surumKimligi';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';
const KOKEN = 'https://app.cetpa.com.tr';

describe('saf karar (S3)', () => {
  it('aynı sürüm → şerit yok; farklı → var; kapatılan sürüm → yok; daha yeni sürüm → yine var', () => {
    expect(yeniSurumSeridiGerekli(A, A, null)).toBe(false);
    expect(yeniSurumSeridiGerekli(A, B, null)).toBe(true);           // T4: karşılaştırma ters çevrilirse kırmızı
    expect(yeniSurumSeridiGerekli(A, B, B)).toBe(false);             // T4: kapatma hafızası yok sayılırsa kırmızı
    expect(yeniSurumSeridiGerekli(A, C, B)).toBe(true);
  });
  it('kimliklerden biri bilinmiyorsa bildirim YOK (bilinmeyen sürüm «yeni» sayılmaz)', () => {
    expect(yeniSurumSeridiGerekli(null, B, null)).toBe(false);
    expect(yeniSurumSeridiGerekli(A, null, null)).toBe(false);
    expect(yeniSurumSeridiGerekli(null, null, null)).toBe(false);
  });
  it('kimlik biçimi: yalnız 16 haneli küçük onaltılık', () => {
    expect(surumGecerli(A)).toBe(true);
    for (const d of ['', 'AAAAAAAAAAAAAAAA', 'aaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaaa', '../../etc/passwd', null, undefined, 12, { surum: A }]) {
      expect(surumGecerli(d), String(d)).toBe(false);
    }
  });
  it('sunucu yanıtı yalnız `{ surum }` biçiminden okunur', () => {
    expect(sunucuYanitiniAyikla({ surum: B })).toBe(B);
    expect(sunucuYanitiniAyikla({ surum: null })).toBeNull();
    expect(sunucuYanitiniAyikla({ surum: 'bozuk' })).toBeNull();
    expect(sunucuYanitiniAyikla(null)).toBeNull();
    expect(sunucuYanitiniAyikla('bbbbbbbbbbbbbbbb')).toBeNull();
  });
  it('gömülü kimlik `<meta name="cetpa-surum">`dan; yoksa / bozuksa null', () => {
    const belge = document.implementation.createHTMLDocument('x');
    expect(gomuluSurumuOku(belge)).toBeNull();
    const meta = belge.createElement('meta');
    meta.setAttribute('name', SURUM_META_ADI);
    meta.setAttribute('content', 'bozuk');
    belge.head.appendChild(meta);
    expect(gomuluSurumuOku(belge)).toBeNull();
    meta.setAttribute('content', A);
    expect(gomuluSurumuOku(belge)).toBe(A);
  });
  it('eksik parça adresi: Chrome / Firefox / Vite stil iletisinden; başka köken ya da /assets dışı → null', () => {
    expect(parcaAdresiniBul(new TypeError(`Failed to fetch dynamically imported module: ${KOKEN}/assets/MuhasebePage-Ab12_c.js`), KOKEN))
      .toBe(`${KOKEN}/assets/MuhasebePage-Ab12_c.js`);
    expect(parcaAdresiniBul(new TypeError(`error loading dynamically imported module: ${KOKEN}/assets/X-1.js`), KOKEN)).toBe(`${KOKEN}/assets/X-1.js`);
    expect(parcaAdresiniBul(new Error('Unable to preload CSS for /assets/index-Zz9.css'), KOKEN)).toBe(`${KOKEN}/assets/index-Zz9.css`);
    expect(parcaAdresiniBul(new TypeError('Importing a module script failed.'), KOKEN)).toBeNull();
    expect(parcaAdresiniBul(new TypeError('Failed to fetch dynamically imported module: https://kotu.example/assets/X.js'), KOKEN)).toBeNull();
    expect(parcaAdresiniBul(new TypeError(`Failed to fetch dynamically imported module: ${KOKEN}/src/X.tsx`), KOKEN)).toBeNull();
    expect(parcaAdresiniBul(undefined, KOKEN)).toBeNull();
  });
});

describe('depo: kapatma hafızası', () => {
  it('kapat → şerit kalkar, şeridi çıkaran sürüm hafızada; gizle hafızaya dokunmaz', () => {
    const depo = seritDeposuOlustur();
    const bildirim = vi.fn();
    depo.abone(bildirim);
    depo.goster({ tur: 'yeni-surum', surum: B });
    expect(depo.durum()).toEqual({ tur: 'yeni-surum', surum: B });
    depo.goster({ tur: 'yeni-surum', surum: B });                     // aynı durum: yayın yok
    expect(bildirim).toHaveBeenCalledTimes(1);
    depo.kapat();
    expect(depo.durum()).toBeNull();
    expect(depo.kapatilan()).toBe(B);
    depo.goster({ tur: 'yeni-surum', surum: C });
    depo.gizle();
    expect(depo.kapatilan()).toBe(B);
  });

  it('Y6 bekleyen: yalnız sürümsüz «sayfa yenileme» kapatması işaretler; bir kez bağlanır; sürümlü kapatma bekleyeni siler', () => {
    const depo = seritDeposuOlustur();
    depo.bekleyeniBagla(B);                                           // bekleyen yok → hafıza değişmez
    expect(depo.kapatilan()).toBeNull();
    depo.goster({ tur: 'sayfa-yenileme', surum: null });
    depo.gizle();                                                     // gizle kapatma değildir → bekleyen işaretlenmez
    depo.bekleyeniBagla(B);
    expect(depo.kapatilan()).toBeNull();
    depo.goster({ tur: 'sayfa-yenileme', surum: null });
    depo.kapat();
    expect(depo.kapatilan()).toBeNull();
    depo.bekleyeniBagla(B);
    expect(depo.kapatilan()).toBe(B);
    depo.bekleyeniBagla(C);                                           // tüketildi: ikinci bağlama hafızayı değiştirmez
    expect(depo.kapatilan()).toBe(B);
    // Bekleyen varken sürümlü bir şerit kapatılırsa kapatma o sürüme bağlıdır; eski bekleyen sonraki yayını bastırmaz.
    depo.goster({ tur: 'sayfa-yenileme', surum: null });
    depo.kapat();
    depo.goster({ tur: 'sayfa-yenileme', surum: C });
    depo.kapat();
    expect(depo.kapatilan()).toBe(C);
    depo.bekleyeniBagla(A);
    expect(depo.kapatilan()).toBe(C);
  });
});

// ── Zamanlama ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

class SahteBelge extends EventTarget { visibilityState: DocumentVisibilityState = 'visible'; }
class SahtePencere extends EventTarget { readonly location = { origin: KOKEN }; }

type Yanitlayici = (adres: string, init?: RequestInit) => Promise<Response>;
const json = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });

let depo: SeritDeposu;
let belge: SahteBelge;
let pencere: SahtePencere;
let istekler: Array<{ adres: string; init?: RequestInit }>;
let sunucuSurumu: string | null;
let yanitlayici: Yanitlayici;
let uyarilar: string[];
let durdur: () => void;

/** Gezinme varsayılanı olağan açılış; `{}` verilirse (seçenek yok) denetim tarayıcının gezinme kaydını kendisi okur. */
function baslat(gomulu: string | null = A, gezinme: { gezinmeTuru?: string | null } = { gezinmeTuru: 'navigate' }): void {
  durdur = surumDenetimiBaslat({
    gomulu, depo, belge, pencere, ...gezinme,
    getir: (adres, init) => { istekler.push({ adres, init }); return yanitlayici(adres, init); },
    uyar: (ileti) => { uyarilar.push(ileti); },
  });
}
const ilerle = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const gorunurYap = async () => { belge.visibilityState = 'visible'; belge.dispatchEvent(new Event('visibilitychange')); await ilerle(0); };
const gizle = () => { belge.visibilityState = 'hidden'; belge.dispatchEvent(new Event('visibilitychange')); };
const surumIstekleri = () => istekler.filter(i => i.adres === SURUM_UCU);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T09:00:00+03:00'));
  depo = seritDeposuOlustur();
  belge = new SahteBelge();
  pencere = new SahtePencere();
  istekler = [];
  uyarilar = [];
  sunucuSurumu = A;
  yanitlayici = async () => json({ surum: sunucuSurumu });
});
afterEach(() => { durdur?.(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('T1 — 5 dakikalık denetim ve görünürlük (sahte zamanlayıcı)', () => {
  it('aralıklar şartnamedeki değerde: düzenli denetim 5 dakika (S3), görünürlük alt sınırı 1 dakika', () => {
    // Öbür sınamalar sabitin kendisiyle ilerler; değer değişirse onlar yeşil kalırdı — değer burada sabitlenir.
    expect(SURUM_DENETIM_ARALIGI_MS).toBe(5 * 60 * 1000);
    expect(GORUNURLUK_EN_AZ_ARA_MS).toBe(60 * 1000);
  });

  it('açılışta sorulmaz; ilk soru 5 dakika sonra, önbelleksiz ve çerezsiz', async () => {
    baslat();
    await ilerle(SURUM_DENETIM_ARALIGI_MS - 1);
    expect(surumIstekleri()).toHaveLength(0);
    await ilerle(1);
    expect(surumIstekleri()).toHaveLength(1);
    expect(surumIstekleri()[0].init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(surumIstekleri()).toHaveLength(2);
  });

  it('geri / ileri gezinme (`back_forward`) → açılışta BİR KEZ sorar (index.html önbellekten gelmiş olabilir); düzenli tur değişmez', async () => {
    sunucuSurumu = B;
    baslat(A, { gezinmeTuru: 'back_forward' });
    await ilerle(0);
    expect(surumIstekleri()).toHaveLength(1);                         // Y1: açılış sorusu silinirse kırmızı
    expect(surumIstekleri()[0].init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    expect(depo.durum()).toEqual({ tur: 'yeni-surum', surum: B });
    await ilerle(SURUM_DENETIM_ARALIGI_MS - 1);
    expect(surumIstekleri()).toHaveLength(1);                         // BİR KEZ: açılış sorusu tekrarlanmaz
    await ilerle(1);
    expect(surumIstekleri()).toHaveLength(2);
  });

  it('olağan açılış (`navigate`), yenileme (`reload`), bilinmeyen (`null`) → açılışta SORULMAZ', async () => {
    for (const tur of ['navigate', 'reload', 'prerender', null]) {
      baslat(A, { gezinmeTuru: tur });
      await ilerle(0);
      expect(surumIstekleri(), String(tur)).toHaveLength(0);          // Y1: koşul «her açılışta sor»a dönerse kırmızı
      durdur();
    }
  });

  it('seçenek verilmezse gezinme türü tarayıcının kaydından okunur (`PerformanceNavigationTiming.type`)', async () => {
    expect(gezinmeTuruOku()).toBeNull();                              // jsdom gezinme kaydı vermez → bilinmiyor
    const kayit = { name: KOKEN, entryType: 'navigation', startTime: 0, duration: 0, toJSON: () => ({}), type: 'back_forward' };
    const sorgu = vi.spyOn(performance, 'getEntriesByType').mockReturnValue([kayit]);
    expect(gezinmeTuruOku()).toBe('back_forward');
    expect(sorgu).toHaveBeenCalledWith('navigation');
    baslat(A, {});
    await ilerle(0);
    expect(surumIstekleri()).toHaveLength(1);                         // varsayılan okuma bağlı değilse kırmızı
    sorgu.mockImplementation(() => { throw new Error('desteklenmiyor'); });
    expect(gezinmeTuruOku()).toBeNull();
  });

  it('aynı sürüm → şerit yok', async () => {
    baslat();
    await ilerle(SURUM_DENETIM_ARALIGI_MS * 3);
    expect(surumIstekleri()).toHaveLength(3);
    expect(depo.durum()).toBeNull();
  });

  it('farklı sürüm → şerit (T4: karşılaştırma ters çevrilirse kırmızı)', async () => {
    baslat();
    sunucuSurumu = B;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()).toEqual({ tur: 'yeni-surum', surum: B });
  });

  it('kapat → aynı farklı sürümde yine YOK; daha yeni sürümde VAR (T4: kapatma hafızası silinirse kırmızı)', async () => {
    baslat();
    sunucuSurumu = B;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()?.surum).toBe(B);
    depo.kapat();
    await ilerle(SURUM_DENETIM_ARALIGI_MS * 2);
    expect(surumIstekleri()).toHaveLength(3);
    expect(depo.durum()).toBeNull();
    sunucuSurumu = C;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()).toEqual({ tur: 'yeni-surum', surum: C });
  });

  it('ağ hatası, 5xx, 429, bozuk yanıt → şerit YOK; art arda hatalarda konsola TEK uyarı, başarıdan sonra yeniden uyarır', async () => {
    baslat();
    sunucuSurumu = B;
    yanitlayici = async () => { throw new TypeError('Failed to fetch'); };
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    yanitlayici = async () => json({ error: 'Sunucu hatası.' }, 502);
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    yanitlayici = async () => json({ error: 'Too many requests' }, 429);
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    yanitlayici = async () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(surumIstekleri()).toHaveLength(4);
    expect(depo.durum()).toBeNull();
    expect(uyarilar).toHaveLength(1);
    // Başarılı bir denetim sayacı sıfırlar; sonraki hata yine (tek) uyarı verir.
    yanitlayici = async () => json({ surum: A });
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    yanitlayici = async () => { throw new TypeError('Failed to fetch'); };
    await ilerle(SURUM_DENETIM_ARALIGI_MS * 2);
    expect(uyarilar).toHaveLength(2);
    expect(depo.durum()).toBeNull();
  });

  it('sunucuda kimlik yok (`{ surum: null }`) → şerit yok', async () => {
    baslat();
    sunucuSurumu = null;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(surumIstekleri()).toHaveLength(1);
    expect(depo.durum()).toBeNull();
  });

  it('gömülü kimlik YOK → denetim hiç başlamaz: istek yok, dinleyici yok (S1: kimlik uydurulmaz)', async () => {
    baslat(null);
    sunucuSurumu = B;
    await ilerle(SURUM_DENETIM_ARALIGI_MS * 3);
    await gorunurYap();
    pencere.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: new TypeError(`Failed to fetch dynamically imported module: ${KOKEN}/assets/X.js`) }));
    await ilerle(0);
    expect(istekler).toEqual([]);
    expect(depo.durum()).toBeNull();
  });

  it('sekme yeniden görünür olunca sorar (son denetimden en az 1 dk sonra); gizliyken 5 dk turu atlanır', async () => {
    baslat();
    sunucuSurumu = B;
    await ilerle(GORUNURLUK_EN_AZ_ARA_MS - 1);
    gizle(); await gorunurYap();
    expect(surumIstekleri()).toHaveLength(0);                       // açılıştan bu yana 1 dk dolmadı
    await ilerle(1);
    gizle(); await gorunurYap();
    expect(surumIstekleri()).toHaveLength(1);
    expect(depo.durum()?.surum).toBe(B);
    depo.kapat();
    gizle();
    await ilerle(SURUM_DENETIM_ARALIGI_MS * 2);                      // gizli: düzenli tur sormaz
    expect(surumIstekleri()).toHaveLength(1);
    sunucuSurumu = C;
    await gorunurYap();
    expect(surumIstekleri()).toHaveLength(2);
    expect(depo.durum()?.surum).toBe(C);
  });

  it('yayın geri alınırsa (sunucu yine sekmenin sürümü) şerit kalkar', async () => {
    baslat();
    sunucuSurumu = B;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()?.surum).toBe(B);
    sunucuSurumu = A;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()).toBeNull();
  });

  it('durdur → zamanlayıcı ve dinleyiciler kalkar', async () => {
    baslat();
    durdur();
    sunucuSurumu = B;
    await ilerle(SURUM_DENETIM_ARALIGI_MS * 2);
    await gorunurYap();
    expect(istekler).toEqual([]);
  });
});

describe('S4 — eksik sayfa parçası (`vite:preloadError`)', () => {
  const yuklemeHatasi = (hata: unknown) => {
    pencere.dispatchEvent(Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: hata }));
    return ilerle(0);
  };
  const PARCA = `${KOKEN}/assets/MuhasebePage-Ab12.js`;

  it('adres iletide ve sunucu 404 → «Bu sayfa için yenileme gerekiyor»; HEAD önbelleksiz', async () => {
    baslat();
    yanitlayici = async (adres) => adres === PARCA ? new Response('Not found', { status: 404 }) : json({ surum: A });
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    // 404 doğrulanınca sunucunun sürümü de sorulur (Y2); sunucu sekmenin sürümünde (A) → şerit sürüme bağlanmaz (`null`).
    expect(istekler.map(i => [i.adres, i.init?.method])).toEqual([[PARCA, 'HEAD'], [SURUM_UCU, undefined]]);
    expect(istekler[0].init).toMatchObject({ cache: 'no-store' });
    expect(istekler[1].init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    expect(depo.durum()).toEqual({ tur: 'sayfa-yenileme', surum: null });
  });

  it('404 şeridi parçayı kaldıran yayına bağlanır: kapat + 5 dk + sunucu aynı B → şerit YOK; daha yeni C → yine var', async () => {
    baslat();
    yanitlayici = async (adres) => adres === PARCA ? new Response('Not found', { status: 404 }) : json({ surum: sunucuSurumu });
    sunucuSurumu = B;
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    expect(depo.durum()).toEqual({ tur: 'sayfa-yenileme', surum: B });  // Y2: `surum: null`a dönerse kırmızı
    depo.kapat();
    expect(depo.kapatilan()).toBe(B);
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(surumIstekleri()).toHaveLength(2);
    expect(depo.durum()).toBeNull();                                  // aynı yayın için şerit geri GELMEZ
    sunucuSurumu = C;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()).toEqual({ tur: 'yeni-surum', surum: C });
  });

  it('«yeni sürüm» B şeridi açıkken 404 → sayfa şeridi B; kapat + 5 dk → şerit YOK', async () => {
    baslat();
    yanitlayici = async (adres) => adres === PARCA ? new Response('Not found', { status: 404 }) : json({ surum: sunucuSurumu });
    sunucuSurumu = B;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()).toEqual({ tur: 'yeni-surum', surum: B });
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    expect(depo.durum()).toEqual({ tur: 'sayfa-yenileme', surum: B });
    depo.kapat();
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(surumIstekleri()).toHaveLength(3);
    expect(depo.durum()).toBeNull();                                  // Y2: 404 şeridi `null`la kapanırsa B şeridi geri gelir → kırmızı
  });

  it('Y6: 404 + sürüm sorusu ağ hatası → sürümsüz şerit; kapat + 5 dk + sunucu B → şerit YOK (bekleyen kapatma B\'ye bağlanır); daha yeni C → var', async () => {
    baslat();
    let surumAgHatasi = true;
    yanitlayici = async (adres) => {
      if (adres === PARCA) return new Response('Not found', { status: 404 });
      if (surumAgHatasi) throw new TypeError('Failed to fetch');
      return json({ surum: sunucuSurumu });
    };
    sunucuSurumu = B;
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    expect(depo.durum()).toEqual({ tur: 'sayfa-yenileme', surum: null });
    depo.kapat();
    expect(depo.kapatilan()).toBeNull();                              // sürüm bilinmiyor: henüz bağlanacak sürüm yok
    surumAgHatasi = false;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(surumIstekleri()).toHaveLength(2);
    expect(depo.durum()).toBeNull();                                  // Y6: bekleyen bağlanmazsa B şeridi çıkar → kırmızı
    expect(depo.kapatilan()).toBe(B);
    sunucuSurumu = C;
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()).toEqual({ tur: 'yeni-surum', surum: C });   // bekleyen bir kez tüketilir; sonraki yayın yine görünür
  });

  it('Y6: bekleyen kapatmayı ağ hatası, 5xx ve sekmenin kendi sürümü (A) TÜKETMEZ; ilk farklı sürüm (B) bağlanır', async () => {
    baslat();
    let surumYaniti: () => Promise<Response> = async () => { throw new TypeError('Failed to fetch'); };
    yanitlayici = async (adres) => adres === PARCA ? new Response('Not found', { status: 404 }) : surumYaniti();
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    expect(depo.durum()).toEqual({ tur: 'sayfa-yenileme', surum: null });
    depo.kapat();
    await ilerle(SURUM_DENETIM_ARALIGI_MS);                           // ağ hatası: ölçüm yok
    surumYaniti = async () => json({ error: 'Sunucu hatası.' }, 502);
    await ilerle(SURUM_DENETIM_ARALIGI_MS);                           // 5xx: ölçüm yok
    surumYaniti = async () => json({ surum: A });
    await ilerle(SURUM_DENETIM_ARALIGI_MS);                           // sunucu hâlâ sekmenin sürümünü bildiriyor (yeniden başlamamış)
    expect(depo.kapatilan()).toBeNull();
    expect(depo.durum()).toBeNull();
    surumYaniti = async () => json({ surum: B });
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(surumIstekleri()).toHaveLength(5);
    expect(depo.kapatilan()).toBe(B);                                 // Y6: «her başarılı ölçüm tüketir»e dönerse A'da tükenir → kırmızı
    expect(depo.durum()).toBeNull();
  });

  it('404 doğrulandı ama sunucu sürümü ölçülemedi (ağ / 5xx) → sayfa şeridi yine çıkar (`surum: null`)', async () => {
    baslat();
    yanitlayici = async (adres) => adres === PARCA ? new Response('Not found', { status: 404 }) : json({ error: 'Sunucu hatası.' }, 502);
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    expect(depo.durum()).toEqual({ tur: 'sayfa-yenileme', surum: null });
    depo.gizle();
    yanitlayici = async (adres) => {
      if (adres === PARCA) return new Response('Not found', { status: 404 });
      throw new TypeError('Failed to fetch');
    };
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    expect(depo.durum()).toEqual({ tur: 'sayfa-yenileme', surum: null });
  });

  it('parça sunucuda VAR (200) ya da ağ kopuk → şerit yok', async () => {
    baslat();
    yanitlayici = async () => new Response('', { status: 200 });
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    expect(depo.durum()).toBeNull();
    yanitlayici = async () => { throw new TypeError('Failed to fetch'); };
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    expect(depo.durum()).toBeNull();
    expect(uyarilar).toHaveLength(1);
  });

  it('adres iletide yok (Safari) → sunucu sürümü farklıysa sayfa şeridi, aynıysa yok', async () => {
    baslat();
    await yuklemeHatasi(new TypeError('Importing a module script failed.'));
    expect(surumIstekleri()).toHaveLength(1);
    expect(depo.durum()).toBeNull();
    sunucuSurumu = B;
    await yuklemeHatasi(new TypeError('Importing a module script failed.'));
    expect(depo.durum()).toEqual({ tur: 'sayfa-yenileme', surum: B });
  });

  it('sayfa şeridi açıkken düzenli denetim onu «yeni sürüm» şeridiyle EZMEZ', async () => {
    baslat();
    yanitlayici = async (adres) => adres === PARCA ? new Response('Not found', { status: 404 }) : json({ surum: B });
    await yuklemeHatasi(new TypeError(`Failed to fetch dynamically imported module: ${PARCA}`));
    await ilerle(SURUM_DENETIM_ARALIGI_MS);
    expect(depo.durum()?.tur).toBe('sayfa-yenileme');
  });

  it('kendiliğinden yenileme YOK: denetim yalnız depoya yazar (sayfa yenileme işlevi bu modülde çağrılmaz)', () => {
    const kaynak = kodSatirlari(join(SRC_KOK, 'lib', 'yeniSurum.ts')).map(s => s.kod).join('\n');
    expect(kaynak).toMatch(/depo\.goster\(/);
    expect(kaynak).not.toMatch(/\.reload\s*\(/);
  });
});
