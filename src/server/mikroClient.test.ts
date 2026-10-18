/**
 * mikroClient.test.ts — Mikro zarf ayrıştırma + SQL kapısı girdi doğrulama (Faz 1 4/n, 2026-09-05).
 *
 * Faz 0: `src/server/` altında Mikro istemcisinin saf yardımcıları TESTSİZDİ; oysa
 * `mikroSatirlar` bir kez yanlış yazıldığında (dizi sarmalına inmiyordu) mizan/KDV/7 liste
 * import'u aylarca SESSİZCE 0 kayıt vermişti (2026-07-30, yorum dosyada). Bu dosya:
 *  - zarfın üç gözlenen şeklini (nesne / DİZİ / liste) kilitler,
 *  - miktar ve fiyatta "0 ya da boş = BİLİNMİYOR, yazma" sözleşmesini kilitler
 *    (Mikro tanımsız kademeyi 0 döndürür; 0 yazmak elle girilen fiyatı ezer),
 *  - SqlVeriOkuV2 kapısında string birleştirilen değerlerin KATI doğrulandığını kilitler (SQLi).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mikroStokMiktari, mikroSatisFiyatlari, mikroData, mikroSatirlar, mikroHata,
  sqlTarih, sqlTamsayi, sqlTanimlayici,
} from './mikroClient';

describe('mikroStokMiktari — kart miktarı: yoksa null, 0 gerçek sıfır', () => {
  it("sto_mevcut_mik sayısal string kabul; yoksa toplam_miktar'a düşer", () => {
    expect(mikroStokMiktari({ sto_mevcut_mik: '12.5' })).toBe(12.5);
    expect(mikroStokMiktari({ toplam_miktar: 3 })).toBe(3);
    expect(mikroStokMiktari({ sto_mevcut_mik: 0 })).toBe(0);
  });
  it("alan yok / '' / 'abc' → null (0 DEĞİL — mevcut stockLevel ezilmez)", () => {
    expect(mikroStokMiktari({})).toBeNull();
    expect(mikroStokMiktari({ sto_mevcut_mik: '' })).toBeNull();
    expect(mikroStokMiktari({ sto_mevcut_mik: 'abc' })).toBeNull();
    expect(mikroStokMiktari({ sto_mevcut_mik: null })).toBeNull();
  });
});

describe('mikroSatisFiyatlari — kademeler; 0/boş fiyat DÖNMEZ', () => {
  it('satis_fiyatlari[] listesi önce, sonra kart alanları; ilk geçerli kaynak kazanır', () => {
    const p = mikroSatisFiyatlari({
      satis_fiyatlari: [{ sfiyat_fiyati: 100 }, { sfiyat_fiyati: 0 }, {}, { sfiyat_fiyati: '80' }],
      sto_satis_fiyat1: 999, sto_satis_fiyat2: 90,
    });
    expect(p).toEqual({ Retail: 100, 'B2B Standard': 90, Dealer: 80 });   // B2B Premium hiçbir kaynakta yok → anahtar YOK
  });
  it('hiç fiyat yoksa boş nesne (çağıran prices alanına DOKUNMAZ)', () => {
    expect(mikroSatisFiyatlari({})).toEqual({});
    expect(mikroSatisFiyatlari({ sto_satis_fiyat1: 0, sto_satis_fiyat2: '', sto_satis_fiyat3: 'x' })).toEqual({});
  });
});

describe('mikroData / mikroSatirlar — yanıt zarfının üç şekli', () => {
  it('mikroData: result[0].Data (ya da .data); zarf yoksa {}', () => {
    expect(mikroData({ result: [{ Data: { StokListesi: [1] } }] })).toEqual({ StokListesi: [1] });
    expect(mikroData({ result: [{ data: { x: 1 } }] })).toEqual({ x: 1 });
    expect(mikroData(null)).toEqual({});
    expect(mikroData('Api Server Error')).toEqual({});
  });
  it('nesne sarmalı: Data = { SQLResult1: [...] }', () => {
    expect(mikroSatirlar({ result: [{ Data: { SQLResult1: [{ a: 1 }] } }] })).toEqual([{ a: 1 }]);
  });
  it('DİZİ sarmalı (SqlVeriOkuV2): Data = [ { SQLResult1: [...] } ] — eski kod burada hep [] dönüyordu', () => {
    expect(mikroSatirlar({ result: [{ Data: [{ SQLResult1: [{ cha_kod: 'C1' }] }] }] })).toEqual([{ cha_kod: 'C1' }]);
  });
  it('liste metodu: Data = { StokListesi: [...] }; boş/hatalı zarf → []', () => {
    expect(mikroSatirlar({ result: [{ Data: { StokListesi: [{ sto_kod: 'S1' }] } }] })).toEqual([{ sto_kod: 'S1' }]);
    expect(mikroSatirlar({ result: [{ Data: {} }] })).toEqual([]);
    expect(mikroSatirlar(undefined)).toEqual([]);
  });
  it('mikroHata: ErrorMessage > ham string (200 kr) > fallback', () => {
    expect(mikroHata({ result: [{ ErrorMessage: 'Metot V17\'de yok' }] })).toBe('Metot V17\'de yok');
    expect(mikroHata('x'.repeat(300))).toHaveLength(200);
    expect(mikroHata({ result: [{}] })).toBe('Mikro API yanıt vermedi.');
    expect(mikroHata(null, 'özel')).toBe('özel');
  });
});

describe('SqlVeriOkuV2 kapısı — string literal’e giren her değer KATI doğrulanır (SQLi)', () => {
  it("sqlTarih: yalnız YYYY-MM-DD; enjeksiyon denemesi varsayılana düşer", () => {
    expect(sqlTarih('2026-09-05', '2000-01-01')).toBe('2026-09-05');
    expect(sqlTarih(" 2026-09-05 ", '2000-01-01')).toBe('2026-09-05');
    expect(sqlTarih("2026-09-05' OR 1=1 --", '2000-01-01')).toBe('2000-01-01');
    expect(sqlTarih('05.09.2026', '2000-01-01')).toBe('2000-01-01');
    expect(sqlTarih(undefined, '2000-01-01')).toBe('2000-01-01');
  });
  it('sqlTamsayi: aralık dışı / sayısal olmayan → varsayılan; ondalık kırpılır', () => {
    expect(sqlTamsayi('42', 10)).toBe(42);
    expect(sqlTamsayi(3.9, 10)).toBe(3);
    expect(sqlTamsayi('abc', 10)).toBe(10);
    expect(sqlTamsayi(-1, 10)).toBe(10);
    expect(sqlTamsayi(100001, 10)).toBe(10);
    expect(sqlTamsayi(7, 10, 8, 20)).toBe(10);
  });
  it('sqlTanimlayici: tablo/kolon adı yalnız [A-Za-z_][A-Za-z0-9_]*', () => {
    expect(sqlTanimlayici('STOKLAR')).toBe('STOKLAR');
    expect(sqlTanimlayici(' sto_kod ')).toBe('sto_kod');
    expect(sqlTanimlayici('STOKLAR; DROP TABLE x')).toBeNull();
    expect(sqlTanimlayici('1abc')).toBeNull();
    expect(sqlTanimlayici('şube')).toBeNull();
    expect(sqlTanimlayici(null)).toBeNull();
  });
});

// ── mikroPost `zamanAsimiMs` seçeneği (mikro-import-arkaplan, 2026-09-24) ─────────────────────
// server.ts:76-79 global 30 sn `fetch` yaması yalnız `signal`SIZ çağrılara uygulanır. Import sayfası
// (500 satır SqlVeriOkuV2) 30 sn'yi aşabildiği için liste çağrıları kendi `AbortSignal.timeout`unu
// geçer; seçeneksiz çağrılar `signal` GEÇMEZ ki global yama aynen işlesin.
//
// Stub tarifi: `MIKRO_LOCAL=1` (getMikroCreds lokal mod, token yolu atlanır — MIKRO_LOCAL_MODE modül
// sabiti olduğu için modül `vi.resetModules` + dinamik import ile taze yüklenir) + asılı `fetch`
// stub'u (signal'e SAYGILI: iptal gelince reject — gerçek undici de böyle yapar). Gerçek zaman (5 ms).
describe('mikroPost — secenek.zamanAsimiMs → AbortSignal.timeout; seçeneksiz çağrı signal geçmez', () => {
  const fetchCagrilari: Array<{ url: string; init: RequestInit | undefined }> = [];
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('MIKRO_LOCAL', '1');
    fetchCagrilari.length = 0;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      fetchCagrilari.push({ url, init });
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      // asılı sunucu: hiç yanıt vermez
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('zamanAsimiMs: 5 → asılı sunucuya karşı TimeoutError fırlatır (zamanAsimiMi ayırt eder)', async () => {
    const { mikroPost } = await import('./mikroClient');
    const { zamanAsimiMi } = await import('./mikro/adaptifSayfalama');
    let hata: unknown = null;
    try { await mikroPost('SqlVeriOkuV2', { SQLSorgu: 'SELECT 1' }, false, { zamanAsimiMs: 5 }); }
    catch (e) { hata = e; }
    expect(hata, 'fırlatmalı').not.toBeNull();
    expect((hata as { name?: string }).name).toBe('TimeoutError');
    expect(zamanAsimiMi(hata)).toBe(true);
    expect(fetchCagrilari[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('seçeneksiz çağrı `signal` GEÇMEZ (global 30 sn yaması bozulmadı); mikroSql seçeneği mikroPost\'a geçirir', async () => {
    const { mikroPost, mikroSql } = await import('./mikroClient');
    const asili = mikroPost('SqlVeriOkuV2', { SQLSorgu: 'SELECT 1' });
    await vi.waitFor(() => expect(fetchCagrilari).toHaveLength(1));
    expect(fetchCagrilari[0].init?.signal).toBeUndefined();
    void asili.catch(() => {});   // stub hiç çözmez; test bitince çöp toplanır

    await expect(mikroSql('SELECT 1', { zamanAsimiMs: 5 })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchCagrilari[1].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('listeZamanAsimiMs(): env yoksa 120 sn; 30-600 sn dışı env varsayılana düşer ve uyarır (birim ms)', async () => {
    const uyar = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { listeZamanAsimiMs } = await import('./mikroClient');
    vi.stubEnv('MIKRO_LISTE_ZAMAN_ASIMI_MS', undefined);
    expect(listeZamanAsimiMs()).toBe(120_000);
    vi.stubEnv('MIKRO_LISTE_ZAMAN_ASIMI_MS', '120');   // sn sanıp yazılmış: min altı
    uyar.mockClear();
    expect(listeZamanAsimiMs()).toBe(120_000);
    expect(uyar).toHaveBeenCalledWith(expect.stringContaining('MIKRO_LISTE_ZAMAN_ASIMI_MS'));
    // Aynı geçersiz değer her sayfada log basmasın: uyarı değer başına BİR kez.
    uyar.mockClear();
    expect(listeZamanAsimiMs()).toBe(120_000);
    expect(uyar).not.toHaveBeenCalled();
    vi.stubEnv('MIKRO_LISTE_ZAMAN_ASIMI_MS', '300000');
    expect(listeZamanAsimiMs()).toBe(300_000);
    uyar.mockRestore();
  });

  // Delta hakem 2026-09-25 (bulgu 7, CONFIRMED): değer modül YÜKLENİRKEN okunuyordu; server.ts ise
  // `dotenv.config()`'i tüm statik import'lar (mikroClient dâhil) değerlendirildikten SONRA çağırıyor (ESM).
  // Prod'da NSSM yalnız NODE_ENV/PORT geçiriyor, gerisi C:/cetpa/.env'den → .env'e yazılan
  // MIKRO_LISTE_ZAMAN_ASIMI_MS=300000 hiç okunmuyor, değer 120000 kalıyordu ("yazıldı ama bağlanmadı").
  it('env modül yüklendikten SONRA atanırsa (dotenv sırası) değer YİNE okunur — çağrı anında okuma', async () => {
    vi.stubEnv('MIKRO_LISTE_ZAMAN_ASIMI_MS', undefined);
    vi.resetModules();
    const { listeZamanAsimiMs } = await import('./mikroClient');   // modül env YOKKEN yüklendi
    vi.stubEnv('MIKRO_LISTE_ZAMAN_ASIMI_MS', '300000');            // server.ts:68 dotenv.config() paritesi
    expect(listeZamanAsimiMs()).toBe(300_000);
  });
});

// ── e-Fatura çift kesim (2026-10-17, şartname `.wf/SARTNAME-efatura-cift-kesim.md` § 7 D2) ──────────────────────────────
// BULUT modu (belirteç adımı ve stub tekrarı yalnız orada): `MIKRO_API_URL` sahte bulut adresi, `MIKRO_LOCAL=0`, kimlik bilgisi
// ortamdan. Modül sabitleri yükleme anında okunur → her sınamada `vi.resetModules` + dinamik içe aktarım (stub geri çekilme
// haritası da taze). `fetch` sahtesi isteği hiçbir yere göndermez.
describe('mikroPost — stub tekrarı seçeneği (T22) ve «gönderilmedi» işareti (D2)', () => {
  const TABAN = 'https://mikro.ornek.test:8094/Api/APIMethods';
  let cagrilar: string[] = [];
  let yanitla: (url: string) => Response | Promise<Response> = () => new Response('{}');
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('MIKRO_API_URL', TABAN);
    vi.stubEnv('MIKRO_LOCAL', '0');
    vi.stubEnv('MIKRO_IDM_EMAIL', 'srv@example.test');
    vi.stubEnv('MIKRO_IDM_PASSWORD', 'sinama');
    vi.stubEnv('MIKRO_API_KEY', 'anahtar');
    vi.stubEnv('MIKRO_ALIAS', 'takma');
    cagrilar = [];
    yanitla = (url: string) => (url.includes('onlinekullanici') ? new Response(JSON.stringify({ access_token: 't', expires_in: 21600 })) : new Response(JSON.stringify({ Method: 'X' })));
    vi.stubGlobal('fetch', async (url: string) => { cagrilar.push(url); return yanitla(url); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const yontemCagrisi = (yontem: string): number => cagrilar.filter(u => u === `${TABAN}/${yontem}`).length;

  it('T22 — varsayılan seçenekle stub (başka bir yöntem) → İKİ çağrı (bugünkü davranış aynı); `stubYenidenDeneme: false` → TEK çağrı', async () => {
    const { mikroPost, initMikroClient } = await import('./mikroClient');
    initMikroClient({ getAdminDb: () => null });
    const r = await mikroPost('StokListesiV2', {});
    expect(yontemCagrisi('StokListesiV2')).toBe(2);
    expect(r.data).toEqual({ Method: 'X' });
    vi.resetModules();
    cagrilar = [];
    const taze = await import('./mikroClient');
    taze.initMikroClient({ getAdminDb: () => null });
    await taze.mikroPost('FaturaKaydetV2', { evraklar: [] }, true, { stubYenidenDeneme: false });
    expect(yontemCagrisi('FaturaKaydetV2')).toBe(1);
  });

  it('T22 / İ1-1 — `stubYenidenDeneme: false` stub\'ında da belirteç önbelleği SİLİNİR ve 5 dk damgası yazılır: sonraki çağrı YENİ belirteç ister; FaturaKaydetV2 her çağrıda TEK gönderim', async () => {
    const { mikroPost, initMikroClient } = await import('./mikroClient');
    initMikroClient({ getAdminDb: () => null });
    const belirtecCagrisi = (): number => cagrilar.filter(u => u.includes('onlinekullanici')).length;
    await mikroPost('FaturaKaydetV2', { evraklar: [] }, true, { stubYenidenDeneme: false });
    expect([yontemCagrisi('FaturaKaydetV2'), belirtecCagrisi()]).toEqual([1, 1]);
    // Stub belirteci düşürdü: ikinci fatura çağrısı bayat belirteçle değil, YENİ belirteçle gider — yine TEK gönderim.
    await mikroPost('FaturaKaydetV2', { evraklar: [] }, true, { stubYenidenDeneme: false });
    expect([yontemCagrisi('FaturaKaydetV2'), belirtecCagrisi()]).toEqual([2, 2]);
    // 5 dk damgası ilk stub'da yazıldı: varsayılan seçenekle stub alan başka yöntem TEKRAR ETMEZ (geri çekilme etkin), belirteç
    // de yeniden üretilmez (kendi kendimize IDM kilidini uzatmayalım).
    await mikroPost('StokListesiV2', {});
    expect([yontemCagrisi('StokListesiV2'), belirtecCagrisi()]).toEqual([1, 2]);
  });

  it('kimlik bilgisi yok / belirteç alınamadı → fırlatır ve `mikroGonderilmediMi` doğru (hata nesnesi ve iletisi AYNI); yöntem çağrısı 0', async () => {
    const { mikroPost, mikroGonderilmediMi, initMikroClient } = await import('./mikroClient');
    initMikroClient({ getAdminDb: () => null });
    yanitla = (url: string) => (url.includes('onlinekullanici') ? new Response('kapalı', { status: 500 }) : new Response('{}'));
    let hata: unknown = null;
    try { await mikroPost('FaturaKaydetV2', {}, true, { stubYenidenDeneme: false }); } catch (e) { hata = e; }
    expect(hata).toBeInstanceOf(Error);
    expect((hata as Error).message).toMatch(/^Mikro token alınamadı \(500\)/);
    expect((hata as Error).name).toBe('Error');
    expect(mikroGonderilmediMi(hata)).toBe(true);
    expect(yontemCagrisi('FaturaKaydetV2')).toBe(0);
    vi.stubEnv('MIKRO_IDM_EMAIL', undefined);
    let hata2: unknown = null;
    try { await mikroPost('FaturaKaydetV2', {}, true); } catch (e) { hata2 = e; }
    expect(String((hata2 as Error).message)).toMatch(/kimlik bilgileri bulunamadı/);
    expect(mikroGonderilmediMi(hata2)).toBe(true);
  });

  it('`fetch` BAŞLADIKTAN sonraki hata (ağ, zaman aşımı) «gönderilmedi» SAYILMAZ; stub tekrarının ikinci turunda belirteç düşerse de', async () => {
    const { mikroPost, mikroGonderilmediMi, initMikroClient, mikroTokenCacheMap } = await import('./mikroClient');
    initMikroClient({ getAdminDb: () => null });
    yanitla = (url: string) => { if (url.includes('onlinekullanici')) return new Response(JSON.stringify({ access_token: 't', expires_in: 21600 })); throw new TypeError('fetch failed'); };
    let hata: unknown = null;
    try { await mikroPost('FaturaKaydetV2', {}, true, { stubYenidenDeneme: false }); } catch (e) { hata = e; }
    expect(hata).toBeInstanceOf(TypeError);
    expect(mikroGonderilmediMi(hata)).toBe(false);
    // Varsayılan yol: ilk gövde gitti (stub), tekrar turunda belirteç alınamıyor → hata «gönderilmedi» DEĞİL.
    mikroTokenCacheMap.clear();
    let tur = 0;
    yanitla = (url: string) => {
      if (url.includes('onlinekullanici')) { tur++; return tur === 1 ? new Response(JSON.stringify({ access_token: 't', expires_in: 21600 })) : new Response('kapalı', { status: 500 }); }
      return new Response(JSON.stringify({ Method: 'X' }));
    };
    let hata2: unknown = null;
    try { await mikroPost('SiparisKaydetV2', {}); } catch (e) { hata2 = e; }
    expect(String((hata2 as Error).message)).toMatch(/token alınamadı/);
    expect(mikroGonderilmediMi(hata2)).toBe(false);
    expect(yontemCagrisi('SiparisKaydetV2')).toBe(1);
  });
});

// ── Yazan çağrının ortak seçeneği (2026-10-18, şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md` K0a; § 8.1 H5 / H8) ──────────
// İki kip: LOKAL (`MIKRO_LOCAL=1`, canlı — Ö20) belirteç adımı ve stub tekrarı YOK; BULUT (`MIKRO_LOCAL=0`) stub tekrarı ve 5 dk geri
// çekilme damgası VAR. Modül sabitleri yükleme anında okunur → her sınamada `vi.resetModules` + dinamik içe aktarım.
describe('mikroPost — MIKRO_YAZIM_SECENEGI: LOKAL kipte istek sayısı değişmez; BULUT kipte 5 dk geri çekilme içinde belirteç SİLİNMEZ', () => {
  const TABAN = 'https://mikro.ornek.test:8094/Api/APIMethods';
  let cagrilar: Array<{ url: string; yetki: string | null }> = [];
  let belirtecSayaci = 0;
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('MIKRO_API_URL', TABAN);
    vi.stubEnv('MIKRO_IDM_EMAIL', 'srv@example.test');
    vi.stubEnv('MIKRO_IDM_PASSWORD', 'sinama');
    vi.stubEnv('MIKRO_API_KEY', 'anahtar');
    vi.stubEnv('MIKRO_ALIAS', 'takma');
    cagrilar = [];
    belirtecSayaci = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const basliklar = (init?.headers ?? {}) as Record<string, string>;
      cagrilar.push({ url, yetki: basliklar.Authorization ?? null });
      if (url.includes('onlinekullanici')) { belirtecSayaci++; return new Response(JSON.stringify({ access_token: `t${belirtecSayaci}`, expires_in: 21600 })); }
      return new Response(JSON.stringify({ Method: 'X' }));   // stub: `result` anahtarı yok
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const yontemCagrilari = (yontem: string) => cagrilar.filter(c => c.url === `${TABAN}/${yontem}`);
  const belirtecIstekleri = () => cagrilar.filter(c => c.url.includes('onlinekullanici')).length;

  it('LOKAL (`MIKRO_LOCAL=1`): yazan çağrı stub → Mikro\'ya 1 istek; okuyan çağrı stub → yine 1 istek; belirteç isteği 0', async () => {
    vi.stubEnv('MIKRO_LOCAL', '1');
    const { mikroPost, initMikroClient } = await import('./mikroClient');
    const { MIKRO_YAZIM_SECENEGI } = await import('./mikro/yazimSecenegi');
    initMikroClient({ getAdminDb: () => null });
    // Sıra bilerek: okuyan çağrı ÖNCE — 5 dk geri çekilme damgası henüz yokken. Stub dalı LOKAL'de koşsaydı (M0.15) okuyan
    // çağrı burada İKİ istek atardı; yazan çağrı önce gelseydi damgayı kurar, okuyanın tekrarı geri çekilmede saklanırdı.
    await mikroPost('StokListesiV2', {});
    expect(yontemCagrilari('StokListesiV2')).toHaveLength(1);
    const yazan = await mikroPost('DekontKaydetV2', { evraklar: [] }, true, MIKRO_YAZIM_SECENEGI);
    expect(yazan).toEqual({ ok: true, status: 200, data: { Method: 'X' } });
    expect(yontemCagrilari('DekontKaydetV2')).toHaveLength(1);
    expect(belirtecIstekleri()).toBe(0);
  });

  it('BULUT, 5 dk geri çekilme içinde (H5): okuyan çağrı stub (2 istek, damga kurulur) → yazan çağrı stub → 1 istek, belirteç SİLİNMEZ; ikinci basış AYNI belirteçle', async () => {
    vi.stubEnv('MIKRO_LOCAL', '0');
    const { mikroPost, initMikroClient } = await import('./mikroClient');
    const { MIKRO_YAZIM_SECENEGI } = await import('./mikro/yazimSecenegi');
    initMikroClient({ getAdminDb: () => null });
    await mikroPost('StokListesiV2', {});
    expect(yontemCagrilari('StokListesiV2')).toHaveLength(2);   // bugünkü davranış: belirteç tazelenip bir kez daha
    expect(belirtecIstekleri()).toBe(2);
    await mikroPost('SiparisKaydetV2', { evraklar: [] }, true, MIKRO_YAZIM_SECENEGI);
    expect(yontemCagrilari('SiparisKaydetV2')).toHaveLength(1);
    await mikroPost('SiparisKaydetV2', { evraklar: [] }, true, MIKRO_YAZIM_SECENEGI);
    const yazanlar = yontemCagrilari('SiparisKaydetV2');
    expect(yazanlar).toHaveLength(2);
    expect(belirtecIstekleri()).toBe(2);                        // geri çekilme içinde belirteç ne silindi ne yenilendi
    expect(yazanlar.map(c => c.yetki)).toEqual(['Bearer t2', 'Bearer t2']);
  });
});

// ── Stub sayacı (2026-10-18, şartname yeniden-deneme v3 § 8.2 commit 0-B; H8 (4); M0.16, M0.17) ─────────────────────────────
// `sayi` kip koşulundan ÖNCE artar (LOKAL dâhil); `atlanan` yalnız BULUT dalında ve `stubYenidenDeneme: false` iken (5 dk geri
// çekilme içinde de). Sayaç süreç (modül) içidir → her sınama taze modül.
describe('stubSayaciOzeti — yöntem başına stub ve ikinci gönderimi YAPILMAYAN stub', () => {
  const TABAN = 'https://mikro.ornek.test:8094/Api/APIMethods';
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('MIKRO_API_URL', TABAN);
    vi.stubEnv('MIKRO_IDM_EMAIL', 'srv@example.test');
    vi.stubEnv('MIKRO_IDM_PASSWORD', 'sinama');
    vi.stubEnv('MIKRO_API_KEY', 'anahtar');
    vi.stubEnv('MIKRO_ALIAS', 'takma');
    vi.stubGlobal('fetch', async (url: string) => (url.includes('onlinekullanici')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 21600 }))
      : new Response(JSON.stringify({ Method: 'X' }))));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const kur = async (lokal: '0' | '1') => {
    vi.stubEnv('MIKRO_LOCAL', lokal);
    const m = await import('./mikroClient');
    const { MIKRO_YAZIM_SECENEGI } = await import('./mikro/yazimSecenegi');
    m.initMikroClient({ getAdminDb: () => null });
    return { ...m, MIKRO_YAZIM_SECENEGI };
  };
  const sayac = (o: { yontemler: Record<string, { sayi: number; atlanan: number }> }, y: string) =>
    (o.yontemler[y] ? [o.yontemler[y].sayi, o.yontemler[y].atlanan] : null);

  it('LOKAL: yazan çağrı stub → sayi 1, atlanan 0 (LOKAL\'de ikinci gönderim zaten yok)', async () => {
    const m = await kur('1');
    await m.mikroPost('DekontKaydetV2', {}, true, m.MIKRO_YAZIM_SECENEGI);
    expect(sayac(m.stubSayaciOzeti(), 'DekontKaydetV2')).toEqual([1, 0]);
  });
  it('BULUT, `stubYenidenDeneme: false` → 1 / 1; BULUT varsayılan (okuyan) → 1 / 0', async () => {
    const m = await kur('0');
    await m.mikroPost('DekontKaydetV2', {}, true, m.MIKRO_YAZIM_SECENEGI);
    expect(sayac(m.stubSayaciOzeti(), 'DekontKaydetV2')).toEqual([1, 1]);
    vi.resetModules();
    const taze = await kur('0');
    await taze.mikroPost('StokListesiV2', {});
    expect(sayac(taze.stubSayaciOzeti(), 'StokListesiV2')).toEqual([1, 0]);
  });
  it('BULUT, 5 dk geri çekilme içinde `false` → atlanan yine artar (H5); başarılı yanıt sayılmaz', async () => {
    const m = await kur('0');
    await m.mikroPost('StokListesiV2', {});                                    // damgayı kurar
    await m.mikroPost('SiparisKaydetV2', {}, true, m.MIKRO_YAZIM_SECENEGI);    // geri çekilme dalı
    await m.mikroPost('SiparisKaydetV2', {}, true, m.MIKRO_YAZIM_SECENEGI);
    const o = m.stubSayaciOzeti();
    expect(sayac(o, 'SiparisKaydetV2')).toEqual([2, 2]);
    expect(Number.isFinite(o.baslangic)).toBe(true);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ result: [{ IsError: false }] })));
    await m.mikroPost('SiparisKaydetV2', {}, true, m.MIKRO_YAZIM_SECENEGI);
    expect(sayac(m.stubSayaciOzeti(), 'SiparisKaydetV2')).toEqual([2, 2]);
  });
});
