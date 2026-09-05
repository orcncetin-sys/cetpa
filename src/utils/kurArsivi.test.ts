/**
 * kurArsivi.test.ts — "fatura tarihine göre kur al" SÖZLEŞMESİ (Faz 1 3/n, 2026-09-05).
 *
 * Kur bilinmiyorsa UYDURMA KUR YOK (kullanıcı kararı, bkz. hafıza kur-yoksa-uydurma):
 * `kurAl` null döner, çağıran '—' basar ve kalemi toplama katmaz. En sinsi yol:
 * sunucu `source:'fallback'` ile GÜNCEL kuru döndürür — rakam çıkar ama yanlış
 * dönemin kurudur; o da null sayılır. Ağ hatası kalıcı değildir (tekrar sorulur),
 * "bulunamadı" kalıcıdır (tekrar sorulmaz). Bu dosya o üç ayrımı kilitler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sahteFetch = vi.hoisted(() => vi.fn());
vi.mock('../services/authFetch', () => ({ authFetch: sahteFetch }));
import { kurAl, kurlariYukle, kurYedekMi, kurArsiviTemizle, kurArsiviDoldur } from './kurArsivi';

const yanit = (govde: unknown, ok = true) => ({ ok, json: async () => govde });
beforeEach(() => { kurArsiviTemizle(); sahteFetch.mockReset(); });

describe('kurAl — senkron okuma', () => {
  it('TRY her zaman 1 (tarih/önbellek gerekmez)', () => {
    expect(kurAl(undefined, 'TRY')).toBe(1);
    expect(kurAl('saçma', 'TRY')).toBe(1);
  });
  it('tarih yok / biçim bozuk → null (uydurma yok)', () => {
    expect(kurAl(undefined, 'USD')).toBeNull();
    expect(kurAl(null, 'USD')).toBeNull();
    expect(kurAl('05.09.2026', 'USD')).toBeNull();     // Türk biçimi kabul edilmez, sessizce bugüne düşülmez
    expect(kurAl('2026-9-5', 'USD')).toBeNull();
  });
  it('henüz yüklenmemiş tarih → null', () => {
    expect(kurAl('2026-09-05', 'USD')).toBeNull();
  });
  it('yüklü tarih → kur; bilinmeyen birim → null; 0/negatif/NaN kur → null', () => {
    kurArsiviDoldur('2026-09-05', { USD: 40.12, EUR: 44.03, JPY: 0, GBP: -1, CHF: NaN });
    expect(kurAl('2026-09-05', 'USD')).toBe(40.12);
    expect(kurAl('2026-09-05', 'EUR')).toBe(44.03);
    expect(kurAl('2026-09-05', 'AED')).toBeNull();
    expect(kurAl('2026-09-05', 'JPY')).toBeNull();
    expect(kurAl('2026-09-05', 'GBP')).toBeNull();
    expect(kurAl('2026-09-05', 'CHF')).toBeNull();
  });
  it("YEDEK kur (sunucu güncel kura düşmüş) o tarihin kuru DEĞİLDİR → null, kurYedekMi true", () => {
    kurArsiviDoldur('2026-01-15', { USD: 40 }, true);
    expect(kurAl('2026-01-15', 'USD')).toBeNull();
    expect(kurYedekMi('2026-01-15')).toBe(true);
    expect(kurYedekMi('2026-01-16')).toBe(false);
    expect(kurYedekMi(undefined)).toBe(false);
  });
});

describe('kurlariYukle — ağ yolu', () => {
  it('eksik tarihleri TEK SEFERDE çeker; tekrarları ve geçersiz biçimi atlar; önbellektekini tekrar istemez', async () => {
    kurArsiviDoldur('2026-09-01', { USD: 39 });
    sahteFetch.mockImplementation(async (url: string) => yanit({ success: true, rates: { USD: 40, EUR: 44 }, source: 'tcmb' }));
    await kurlariYukle(['2026-09-05', '2026-09-05', '2026-09-01', 'bozuk', '2026-09-06']);
    const istenen = sahteFetch.mock.calls.map(c => String(c[0])).sort();
    expect(istenen).toEqual(['/api/exchange-rates/at?date=2026-09-05', '/api/exchange-rates/at?date=2026-09-06']);
    expect(kurAl('2026-09-05', 'EUR')).toBe(44);
    expect(kurAl('2026-09-01', 'USD')).toBe(39);   // dokunulmadı
  });
  it("source:'fallback' → yedek:true → kurAl null (yanlış dönemin kuru gösterilmez)", async () => {
    sahteFetch.mockResolvedValue(yanit({ success: true, rates: { USD: 41 }, source: 'fallback' }));
    await kurlariYukle(['2026-02-20']);
    expect(kurAl('2026-02-20', 'USD')).toBeNull();
    expect(kurYedekMi('2026-02-20')).toBe(true);
  });
  it('HTTP hatası / success:false / USD eksik → "bulunamadı" KALICI: tekrar istenmez', async () => {
    sahteFetch.mockResolvedValueOnce(yanit({}, false));
    await kurlariYukle(['2026-03-01']);
    expect(kurAl('2026-03-01', 'USD')).toBeNull();
    sahteFetch.mockResolvedValue(yanit({ success: true, rates: { USD: 40 } }));
    await kurlariYukle(['2026-03-01']);
    expect(sahteFetch).toHaveBeenCalledTimes(1);   // ikinci çağrı yok — bulunamadı kalıcı
    sahteFetch.mockResolvedValueOnce(yanit({ success: true, rates: { EUR: 44 } }));   // USD yok → geçersiz
    await kurlariYukle(['2026-03-02']);
    expect(kurAl('2026-03-02', 'EUR')).toBeNull();
    sahteFetch.mockResolvedValueOnce(yanit({ success: false, rates: { USD: 40 } }));   // success:false → bulunamadı
    await kurlariYukle(['2026-03-03']);
    expect(kurAl('2026-03-03', 'USD')).toBeNull();
  });
  it('ÖRTÜŞEN iki kurlariYukle aynı tarihi ister → uçuştaki istek paylaşılır, fetch BİR kez', async () => {
    let coz: (v: unknown) => void = () => {};
    sahteFetch.mockImplementation(() => new Promise(r => { coz = r; }));
    const a = kurlariYukle(['2026-06-01']);
    const b = kurlariYukle(['2026-06-01']);          // ilk istek hâlâ uçuşta
    await Promise.resolve();
    expect(sahteFetch).toHaveBeenCalledTimes(1);
    coz(yanit({ success: true, rates: { USD: 43 } }));
    await Promise.all([a, b]);
    expect(kurAl('2026-06-01', 'USD')).toBe(43);
  });
  it('AĞ HATASI (throw) kalıcı DEĞİL: önbelleğe yazılmaz, sonraki denemede tekrar sorulur', async () => {
    sahteFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    await kurlariYukle(['2026-04-10']);
    expect(kurAl('2026-04-10', 'USD')).toBeNull();
    sahteFetch.mockResolvedValueOnce(yanit({ success: true, rates: { USD: 42 } }));
    await kurlariYukle(['2026-04-10']);
    expect(sahteFetch).toHaveBeenCalledTimes(2);
    expect(kurAl('2026-04-10', 'USD')).toBe(42);
  });
  it('İKİ PANEL aynı 10 tarihi paralel ister → her tarih BİR kez çekilir (inceleme ölçtü: eskiden 16 istek)', async () => {
    sahteFetch.mockImplementation(async () => { await new Promise(r => setTimeout(r, 3)); return yanit({ success: true, rates: { USD: 40 } }); });
    const tarihler = Array.from({ length: 10 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    await Promise.all([kurlariYukle(tarihler), kurlariYukle(tarihler)]);
    expect(sahteFetch).toHaveBeenCalledTimes(10);
    expect(tarihler.every(t => kurAl(t, 'USD') === 40)).toBe(true);
  });
  it('eş-zamanlılık sınırı: 10 tarih 4\'erli gruplarla çekilir (aynı anda en çok 4 uçuşta)', async () => {
    let ucusta = 0, tepe = 0;
    sahteFetch.mockImplementation(async () => {
      ucusta++; tepe = Math.max(tepe, ucusta);
      await new Promise(r => setTimeout(r, 5));
      ucusta--; return yanit({ success: true, rates: { USD: 40 } });
    });
    await kurlariYukle(Array.from({ length: 10 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`));
    expect(sahteFetch).toHaveBeenCalledTimes(10);
    expect(tepe).toBeLessThanOrEqual(4);
    expect(tepe).toBeGreaterThan(1);
  });
});
