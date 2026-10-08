/**
 * useMagazaTalepleri.test.ts — mağaza taleplerinin istemci aboneliği, savunmacı daraltma ve «yeni» sayacı (dilim 1, 2026-10-08).
 *
 * KİLİTLENEN DEĞİŞMEZLER (şartname § 4 / § 5):
 *   1. `enabled` (= yetki) yanlışken `onSnapshot` HİÇ çağrılmaz — yetkisiz abonelikte sunucu ne hata ne boş init gönderir.
 *   2. Akıştan gelen doküman güvenilmezdir: bilinmeyen SAYI 0 olmaz (`null` / NaN), hiçbir kayıt atılmaz.
 *   3. «Yeni» sayacının sakladığı değer `Date.now()` DEĞİL, görülen taleplerin en büyük `olusturma`'sıdır; sekme AÇIKKEN gelen
 *      talep görülmüş sayılır; `olusturma`'sı çözülemeyen talep sayılmaz; depolama kapalıyken de çalışır.
 *   4. Adresle açılış (`?kaynak=magaza`) yalnız yetkili rolde sekmeyi açar.
 *   5. İlk görüntü süre sınırı: sunucu listeyi HİÇ göndermezse (istemcideki rol sunucudakiyle uyuşmuyor) ekran sonsuza dek
 *      «Yükleniyor…» demez — süre dolunca hata; geç gelen görüntü hatayı siler; yetki düşünce / kapanışta zamanlayıcı kalmaz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { join } from 'node:path';
import { oku, SRC_KOK } from '../test/kaynakTarama';
import {
  useMagazaTalepleri, useMagazaYeniSayaci, magazaTalebiDaralt, magazaIlkKaynakSekmesi,
  magazaTalepOlusturmaMs, enBuyukOlusturmaMs, yeniTalepSayisi,
  magazaSonGorulenAnahtari, magazaSonGorulenOku, magazaSonGorulenYaz,
  MAGAZA_ILK_GORUNTU_SURESI_MS, MAGAZA_ILK_GORUNTU_HATASI,
  type MagazaTalepSatiri,
} from './useMagazaTalepleri';
import type { MagazaTalebi } from '../lib/magazaTalep';

// ── Akış düzeneği: `lib/dbClient` yerine abonelikleri kaydeden sahte ────────────────────────────────────────────────
interface Abonelik { ad: string; next: (s: unknown) => void; err: (e: Error) => void; kapandi: boolean }
const abonelikler: Abonelik[] = [];
vi.mock('../lib/dbClient', () => ({
  collection: (_db: unknown, ad: string) => ({ ad }),
  query: (c: unknown) => c,
  onSnapshot: (q: { ad: string }, next: (s: unknown) => void, err: (e: Error) => void) => {
    const a: Abonelik = { ad: q.ad, next, err, kapandi: false };
    abonelikler.push(a);
    return () => { a.kapandi = true; };
  },
}));

const goruntu = (satirlar: Array<{ id: string; veri: unknown }>) => ({ docs: satirlar.map(s => ({ id: s.id, data: () => s.veri })) });

/** Sunucunun yazdığı biçimde TAM bir talep dokümanı (lib/magazaTalep.ts `MagazaTalebi`). */
const tamTalep: MagazaTalebi = {
  companyId: 'kiraci-1',
  talepNo: 'T261008-5Y9P',
  durum: 'yeni',
  olusturma: '2026-10-08T09:15:00.000Z',
  istemciTarihi: '2026-10-08T09:14:58.000Z',
  musteri: { ad: 'Şükrü Çağlayan', firma: 'Çağlayan İnşaat', telefon: '0532 111 22 33', eposta: 'sukru@ornek.com.tr', il: 'İzmir', adres: 'Işıklar Cad. No: 5\nKat 2', vergi: '1234567890' },
  telefonSon10: '5321112233',
  not: 'Öğleden sonra arayın',
  kalemler: [
    { id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false },
    { id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, talepFiyat: null, tedarik: true },
  ],
  talepEdilen: { araToplam: 409.98, kdv: 82, toplam: 491.98 },
  fiyatiSorulacakVar: true,
  bildirim: { durum: 'gitti', zaman: '2026-10-08T09:15:04.000Z' },
};

beforeEach(() => { abonelikler.length = 0; localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

// ── 1. Savunmacı daraltma ───────────────────────────────────────────────────────────────────────────────────────────
describe('magazaTalebiDaralt — akıştan gelen doküman güvenilmez', () => {
  it('tam dokümanı OLDUĞU GİBI okur ve kimliği ekler (Türkçe harfler aynen)', () => {
    expect(magazaTalebiDaralt('mt-0123', tamTalep)).toEqual({ ...tamTalep, id: 'mt-0123' });
  });

  it('nesne olmayan / boş doküman ATILMAZ: metinler boş, sayılar BİLİNMİYOR, bildirim null', () => {
    for (const ham of [null, undefined, 'abc', 42, [], {}]) {
      const t = magazaTalebiDaralt('mt-x', ham);
      expect(t.id).toBe('mt-x');
      expect(t.talepNo).toBe('');
      expect(t.olusturma).toBe('');
      expect(t.istemciTarihi).toBeNull();
      expect(t.musteri).toEqual({ ad: '', firma: '', telefon: '', eposta: '', il: '', adres: '', vergi: '' });
      expect(t.kalemler).toEqual([]);
      expect(t.talepEdilen).toEqual({ araToplam: null, kdv: null, toplam: null });   // 0 DEĞİL
      expect(t.fiyatiSorulacakVar).toBe(false);
      expect(t.bildirim).toBeNull();
      expect('kirpildi' in t).toBe(false);
    }
  });

  it('kalem fiyatı: yok / null / metin / NaN / sonsuz → null («fiyat sorulacak»); meşru 0 KORUNUR', () => {
    const kalemler = [
      { ad: 'yok' },
      { ad: 'null', talepFiyat: null },
      { ad: 'metin', talepFiyat: '204.99' },
      { ad: 'nan', talepFiyat: NaN },
      { ad: 'sonsuz', talepFiyat: Infinity },
      { ad: 'sifir', talepFiyat: 0 },
      { ad: 'sayi', talepFiyat: 12.5 },
    ];
    const t = magazaTalebiDaralt('mt-1', { kalemler });
    expect(t.kalemler.map(k => k.talepFiyat)).toEqual([null, null, null, null, null, 0, 12.5]);
  });

  it('kalem adedi: sayı değilse NaN (0 «sıfır adet», 1 «bir adet» UYDURULMAZ)', () => {
    const t = magazaTalebiDaralt('mt-1', { kalemler: [{ adet: 3 }, {}, { adet: '3' }, { adet: null }, { adet: Infinity }] });
    expect(t.kalemler[0].adet).toBe(3);
    for (const k of t.kalemler.slice(1)) expect(Number.isNaN(k.adet)).toBe(true);
  });

  it('bozuk kalem (nesne değil) listeden DÜŞMEZ — satırı boş alanlarla kalır (kalem sayısı değişmesin)', () => {
    const t = magazaTalebiDaralt('mt-1', { kalemler: [null, 'x', 7, { sku: 'A-1', tedarik: 'evet' }] });
    expect(t.kalemler).toHaveLength(4);
    expect(t.kalemler[3]).toMatchObject({ sku: 'A-1', ad: '', tedarik: false });   // tedarik yalnız `true` ise doğru
    expect(magazaTalebiDaralt('mt-1', { kalemler: 'bozuk' }).kalemler).toEqual([]);
  });

  it('talep edilen tutarlar: yok / metin → null; meşru 0 KORUNUR', () => {
    expect(magazaTalebiDaralt('a', { talepEdilen: { araToplam: 0, kdv: '82', toplam: null } }).talepEdilen)
      .toEqual({ araToplam: 0, kdv: null, toplam: null });
    expect(magazaTalebiDaralt('a', { talepEdilen: 'bozuk' }).talepEdilen).toEqual({ araToplam: null, kdv: null, toplam: null });
  });

  it('`olusturma` metin değilse boş kalır; kayıt ATILMAZ', () => {
    for (const olusturma of [{ __op: 'serverTimestamp' }, 1759914900000, null]) {
      const t = magazaTalebiDaralt('mt-1', { talepNo: 'T261008-AAAA', olusturma });
      expect(t.olusturma).toBe('');
      expect(t.talepNo).toBe('T261008-AAAA');
    }
  });

  it('bildirim: bilinmeyen durum → null (uydurma «gitti» / «bekliyor» YOK); kapalı küme dışı hata sınıfı ve hata METNİ taşınmaz', () => {
    expect(magazaTalebiDaralt('a', { bildirim: { durum: 'tamam', zaman: 'x' } }).bildirim).toBeNull();
    expect(magazaTalebiDaralt('a', { bildirim: 'gitti' }).bildirim).toBeNull();
    // `toString` gibi miras alınan ad «bilinen durum» sayılmaz.
    expect(magazaTalebiDaralt('a', { bildirim: { durum: 'toString', zaman: 'x' } }).bildirim).toBeNull();
    const b = magazaTalebiDaralt('a', { bildirim: { durum: 'bekliyor', zaman: '2026-10-08T09:15:00.000Z', deneme: 3, hataSinifi: 'tls', hata: 'self signed certificate' } }).bildirim;
    expect(b).toEqual({ durum: 'bekliyor', zaman: '2026-10-08T09:15:00.000Z', deneme: 3, hataSinifi: 'tls' });
    const c = magazaTalebiDaralt('a', { bildirim: { durum: 'gonderilemedi', zaman: 5, deneme: '3', hataSinifi: 'EAUTH 535 parola yanlış' } }).bildirim;
    expect(c).toEqual({ durum: 'gonderilemedi', zaman: '' });
  });

  it('`kirpildi` yalnız TAM `true` ise taşınır; `fiyatiSorulacakVar` yalnız TAM `true` ise doğru', () => {
    expect(magazaTalebiDaralt('a', { kirpildi: true }).kirpildi).toBe(true);
    for (const v of [false, 'true', 1, null]) expect('kirpildi' in magazaTalebiDaralt('a', { kirpildi: v })).toBe(false);
    expect(magazaTalebiDaralt('a', { fiyatiSorulacakVar: true }).fiyatiSorulacakVar).toBe(true);
    expect(magazaTalebiDaralt('a', { fiyatiSorulacakVar: 'true' }).fiyatiSorulacakVar).toBe(false);
  });
});

// ── 2. Abonelik ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('useMagazaTalepleri — abonelik', () => {
  it('`enabled` YANLIŞKEN onSnapshot HİÇ çağrılmaz; durum «yükleniyor» DEĞİL (beklenen bir şey yok)', () => {
    const { result, rerender, unmount } = renderHook(() => useMagazaTalepleri(false));
    rerender();
    expect(abonelikler).toHaveLength(0);
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });
    unmount();
    expect(abonelikler).toHaveLength(0);
  });

  it('`enabled` doğruyken `magazaTalepleri`ne TEK abonelik açar; ilk görüntüye (ya da süre sınırına) kadar «yükleniyor»', () => {
    const { result, rerender } = renderHook(() => useMagazaTalepleri(true));
    expect(abonelikler.map(a => a.ad)).toEqual(['magazaTalepleri']);
    expect(result.current).toEqual({ talepler: [], yukleniyor: true, hata: null });
    rerender();
    rerender();
    expect(abonelikler).toHaveLength(1);   // yeniden çizim yeni abonelik AÇMAZ
  });

  it('görüntü gelince dokümanlar daraltılır; `olusturma`\'sı çözülemeyen kayıt LİSTEDE KALIR', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].next(goruntu([
      { id: 'mt-1', veri: tamTalep },
      { id: 'mt-2', veri: { ...tamTalep, talepNo: 'T261008-BOZK', olusturma: 'dün öğlen' } },
      { id: 'mt-3', veri: null },
    ])));
    expect(result.current.yukleniyor).toBe(false);
    expect(result.current.hata).toBeNull();
    expect(result.current.talepler.map(t => t.id)).toEqual(['mt-1', 'mt-2', 'mt-3']);
    expect(result.current.talepler[0]).toEqual({ ...tamTalep, id: 'mt-1' });
    expect(result.current.talepler[1].olusturma).toBe('dün öğlen');
    expect(magazaTalepOlusturmaMs(result.current.talepler[1])).toBeNull();
  });

  it('abonelik hatası «talep yok» gibi SESSİZ kalmaz: hata metni döner', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].err(new Error('bağlantı koptu')));
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: 'bağlantı koptu' });
  });

  it('yetki düşünce abonelik KAPANIR ve önceki rolün gördüğü talepler bellekte kalmaz; yeniden açılınca «yükleniyor»dan başlar', () => {
    const { result, rerender } = renderHook(({ yetkili }: { yetkili: boolean }) => useMagazaTalepleri(yetkili), { initialProps: { yetkili: true } });
    act(() => abonelikler[0].next(goruntu([{ id: 'mt-1', veri: tamTalep }])));
    expect(result.current.talepler).toHaveLength(1);

    rerender({ yetkili: false });
    expect(abonelikler[0].kapandi).toBe(true);
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });
    expect(abonelikler).toHaveLength(1);

    rerender({ yetkili: true });
    expect(abonelikler).toHaveLength(2);
    expect(result.current).toEqual({ talepler: [], yukleniyor: true, hata: null });
  });

  it('bileşen kaldırılınca abonelik kapanır', () => {
    const { unmount } = renderHook(() => useMagazaTalepleri(true));
    unmount();
    expect(abonelikler[0].kapandi).toBe(true);
  });
});

// ── 2b. İlk görüntü süre sınırı ─────────────────────────────────────────────────────────────────────────────────────
describe('useMagazaTalepleri — ilk görüntü süre sınırı (sunucu listeyi HİÇ göndermezse sonsuz «Yükleniyor…» YOK)', () => {
  const SURE_DOLDU: ReturnType<typeof useMagazaTalepleri> = { talepler: [], yukleniyor: false, hata: MAGAZA_ILK_GORUNTU_HATASI };
  const BEKLENIYOR: ReturnType<typeof useMagazaTalepleri> = { talepler: [], yukleniyor: true, hata: null };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('süre dolmadan «yükleniyor»; TAM dolunca hata — «yükleniyor» DEĞİL, liste boş, metin ne yapılacağını söyler', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS - 1); });
    expect(result.current).toEqual(BEKLENIYOR);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual(SURE_DOLDU);
    expect(MAGAZA_ILK_GORUNTU_HATASI).toBe('sunucu bu listeyi göndermedi (yetki ya da bağlantı) — sayfayı yenileyin');
    // Abonelik AÇIK kalır: geç gelen görüntü buradan gelecek.
    expect(abonelikler).toHaveLength(1);
    expect(abonelikler[0].kapandi).toBe(false);
  });

  it('GEÇ gelen görüntü hatayı siler (yavaş ama meşru abonelik kilitli kalmaz)', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS); });
    expect(result.current).toEqual(SURE_DOLDU);
    act(() => abonelikler[0].next(goruntu([{ id: 'mt-1', veri: tamTalep }, { id: 'mt-2', veri: tamTalep }])));
    expect(result.current.yukleniyor).toBe(false);
    expect(result.current.hata).toBeNull();
    expect(result.current.talepler.map(t => t.id)).toEqual(['mt-1', 'mt-2']);
  });

  it('görüntü ZAMANINDA geldiyse süre dolunca hiçbir şey değişmez', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].next(goruntu([{ id: 'mt-1', veri: tamTalep }])));
    const onceki = result.current;
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS * 3); });
    expect(result.current).toBe(onceki);   // aynı nesne: yeniden çizim bile yok
    expect(result.current.talepler.map(t => t.id)).toEqual(['mt-1']);
  });

  it('boş görüntü de GÖRÜNTÜDÜR: «talep yok» süre dolunca hataya DÖNMEZ', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].next(goruntu([])));
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS * 3); });
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });
  });

  it('abonelik hatası ZAMANINDA geldiyse süre dolunca kendi metni EZİLMEZ', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].err(new Error('bağlantı koptu')));
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS * 3); });
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: 'bağlantı koptu' });
  });

  it('yetki düşünce zamanlayıcı KAPANIR: kapalıyken hata üretilmez; yeniden açılınca süre BAŞTAN sayılır', () => {
    const { result, rerender } = renderHook(({ yetkili }: { yetkili: boolean }) => useMagazaTalepleri(yetkili), { initialProps: { yetkili: true } });
    act(() => { vi.advanceTimersByTime(30_000); });
    rerender({ yetkili: false });
    expect(abonelikler[0].kapandi).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });

    // 60. saniyede yeniden açıldı: ilk açılışın 90. saniyesi (buranın 30. saniyesi) hata ÜRETMEZ.
    rerender({ yetkili: true });
    expect(abonelikler).toHaveLength(2);
    expect(result.current).toEqual(BEKLENIYOR);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current).toEqual(BEKLENIYOR);
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS - 30_000 - 1); });
    expect(result.current).toEqual(BEKLENIYOR);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual(SURE_DOLDU);
  });

  it('bileşen kaldırılınca zamanlayıcı kapanır (bekleyen zamanlayıcı KALMAZ)', () => {
    const { unmount } = renderHook(() => useMagazaTalepleri(true));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('`enabled` yanlışken zamanlayıcı HİÇ kurulmaz (beklenen bir şey yok)', () => {
    const { result } = renderHook(() => useMagazaTalepleri(false));
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS * 3); });
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });
  });

  it('süre 90 sn ve `lib/dbClient.ts` INIT_GUARD_MS ertelemesinden UZUN (çit: erteleme uzarsa bu süre de uzatılır)', () => {
    expect(MAGAZA_ILK_GORUNTU_SURESI_MS).toBe(90_000);
    // Meşru abonelik, uçuştaki başka bir init yüzünden INIT_GUARD_MS kadar ertelenebilir; süre ondan uzun olmasaydı
    // yetkili kullanıcı da «okunamadı» görürdü. Ertelemenin değeri KAYNAKTAN okunur (sınıfın özel alanı; içe aktarılamaz).
    const es = /\bINIT_GUARD_MS = ([\d_]+);/.exec(oku(join(SRC_KOK, 'lib', 'dbClient.ts')));
    expect(es).not.toBeNull();
    const erteleme = Number((es?.[1] ?? '').replace(/_/g, ''));
    expect(erteleme).toBeGreaterThan(0);
    expect(MAGAZA_ILK_GORUNTU_SURESI_MS).toBeGreaterThan(erteleme);
  });
});

// ── 3. Adresle açılış ───────────────────────────────────────────────────────────────────────────────────────────────
describe('magazaIlkKaynakSekmesi — ?kaynak=magaza', () => {
  it('adres `?kaynak=magaza` VE rol yetkiliyse sekme «magaza»', () => {
    expect(magazaIlkKaynakSekmesi('?kaynak=magaza', true)).toBe('magaza');
    expect(magazaIlkKaynakSekmesi('kaynak=magaza', true)).toBe('magaza');
    expect(magazaIlkKaynakSekmesi('?track=abc&kaynak=magaza', true)).toBe('magaza');
  });
  it('YETKİSİZ rolde adres sekmeyi AÇMAZ', () => {
    expect(magazaIlkKaynakSekmesi('?kaynak=magaza', false)).toBe('cetpa');
  });
  it('parametre yok / başka değer / benzer ad → «cetpa»', () => {
    for (const arama of ['', '?', '?kaynak=mikro', '?kaynak=', '?kaynak=MAGAZA', '?kaynak=magaza2', '?xkaynak=magaza', '?kaynak']) {
      expect(magazaIlkKaynakSekmesi(arama, true), arama).toBe('cetpa');
    }
  });
});

// ── 4. «Yeni» sayacı — saf parçalar ─────────────────────────────────────────────────────────────────────────────────
const T = (olusturma: string) => ({ olusturma });
const SABAH = '2026-10-08T06:00:00.000Z', OGLE = '2026-10-08T09:00:00.000Z', AKSAM = '2026-10-08T15:00:00.000Z';
const ms = (iso: string) => Date.parse(iso);

describe('«yeni» sayacı — saf kurallar', () => {
  it('en büyük `olusturma`: çözülemeyenler atlanır; hiçbiri çözülemiyorsa / liste boşsa null', () => {
    expect(enBuyukOlusturmaMs([T(OGLE), T('bozuk'), T(AKSAM), T(SABAH)])).toBe(ms(AKSAM));
    expect(enBuyukOlusturmaMs([T('bozuk'), T('')])).toBeNull();
    expect(enBuyukOlusturmaMs([])).toBeNull();
  });

  it('sayı = `olusturma` > son görülen (EŞİT olan yeni DEĞİL); çözülemeyen SAYILMAZ', () => {
    const talepler = [T(SABAH), T(OGLE), T(AKSAM), T('bozuk'), T('')];
    expect(yeniTalepSayisi(talepler, ms(OGLE))).toBe(1);
    expect(yeniTalepSayisi(talepler, ms(AKSAM))).toBe(0);
    expect(yeniTalepSayisi(talepler, ms(SABAH) - 1)).toBe(3);
  });

  it('son görülen YOKSA çözülebilen bütün talepler yenidir', () => {
    expect(yeniTalepSayisi([T(SABAH), T(OGLE), T('bozuk')], null)).toBe(2);
    expect(yeniTalepSayisi([], null)).toBe(0);
  });

  it('anahtar `cetpa:magazaTalepSonGorulen:<companyId>:<uid>`; kimliklerden biri yoksa null', () => {
    expect(magazaSonGorulenAnahtari('kiraci-1', 'uid-7')).toBe('cetpa:magazaTalepSonGorulen:kiraci-1:uid-7');
    for (const [c, u] of [[null, 'uid-7'], ['kiraci-1', undefined], ['', 'uid-7'], ['kiraci-1', ''], [null, null]] as const) {
      expect(magazaSonGorulenAnahtari(c, u)).toBeNull();
    }
  });

  it('oku / yaz: gidiş-dönüş; bozuk değer → null; değer yalnız İLERİ gider', () => {
    const anahtar = 'cetpa:magazaTalepSonGorulen:k:u';
    expect(magazaSonGorulenOku(anahtar)).toBeNull();
    magazaSonGorulenYaz(anahtar, ms(OGLE));
    expect(localStorage.getItem(anahtar)).toBe(String(ms(OGLE)));
    expect(magazaSonGorulenOku(anahtar)).toBe(ms(OGLE));
    magazaSonGorulenYaz(anahtar, ms(SABAH));                      // geri çekilmez
    expect(magazaSonGorulenOku(anahtar)).toBe(ms(OGLE));
    magazaSonGorulenYaz(anahtar, NaN);                            // sonlu olmayan yazılmaz
    expect(magazaSonGorulenOku(anahtar)).toBe(ms(OGLE));
    for (const bozuk of ['abc', '', '-5', '0', 'NaN', 'Infinity']) {
      localStorage.setItem(anahtar, bozuk);
      expect(magazaSonGorulenOku(anahtar), bozuk).toBeNull();
    }
    expect(magazaSonGorulenOku(null)).toBeNull();
    magazaSonGorulenYaz(null, ms(OGLE));                          // anahtar yokken hiçbir şey yazılmaz
    expect(localStorage.length).toBe(1);
  });

  it('depolama fırlatırsa (özel pencere / kota) oku null döner, yaz SESSİZCE geçer', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(magazaSonGorulenOku('k')).toBeNull();
    expect(() => magazaSonGorulenYaz('k', 5)).not.toThrow();
  });
});

// ── 5. «Yeni» sayacı — kanca ────────────────────────────────────────────────────────────────────────────────────────
describe('useMagazaYeniSayaci', () => {
  const ANAHTAR = 'cetpa:magazaTalepSonGorulen:kiraci-1:uid-7';
  const satir = (id: string, olusturma: string): MagazaTalepSatiri => ({ ...tamTalep, id, olusturma });
  type P = { talepler: MagazaTalepSatiri[]; anahtar: string | null; acik: boolean };
  const kur = (ilk: P) => renderHook((p: P) => useMagazaYeniSayaci(p.talepler, p.anahtar, p.acik), { initialProps: ilk });

  it('anahtar depoda YOKSA bütün (tarihi okunan) talepler yenidir', () => {
    const { result } = kur({ talepler: [satir('a', SABAH), satir('b', OGLE), satir('c', 'bozuk')], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(2);
    expect(localStorage.getItem(ANAHTAR)).toBeNull();   // sekme açılmadan hiçbir şey «görüldü» diye yazılmaz
  });

  it('depodaki son görülenden SONRA gelenler sayılır', () => {
    localStorage.setItem(ANAHTAR, String(ms(SABAH)));
    const { result } = kur({ talepler: [satir('a', SABAH), satir('b', OGLE), satir('c', AKSAM)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(2);
  });

  it('sekme açılınca sayı 0 olur ve saklanan değer görülenlerin EN BÜYÜK `olusturma`\'sıdır — `Date.now()` DEĞİL', () => {
    // Kullanıcının saati 2030: `Date.now()` saklansaydı sonraki bütün talepler «görülmüş» sayılırdı.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00.000Z'));
    const { result } = kur({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: true });
    expect(result.current).toBe(0);
    expect(localStorage.getItem(ANAHTAR)).toBe(String(ms(OGLE)));
  });

  it('sekme AÇIKKEN gelen talep görülmüş sayılır; sekmeden çıkınca 0 kalır, SONRA gelen 1 olur', () => {
    const { result, rerender } = kur({ talepler: [satir('a', SABAH)], anahtar: ANAHTAR, acik: true });
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: true });   // açıkken geldi
    expect(result.current).toBe(0);
    expect(localStorage.getItem(ANAHTAR)).toBe(String(ms(OGLE)));

    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: false });  // sekmeden çıktı
    expect(result.current).toBe(0);

    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE), satir('c', AKSAM)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(1);
  });

  it('sekme açıkken gelen talep TEK ÇİZİMDE bile «yeni» görünmez (rozet yanıp sönmesin)', () => {
    const gorulen: number[] = [];
    const { rerender } = renderHook((p: P) => { const n = useMagazaYeniSayaci(p.talepler, p.anahtar, p.acik); gorulen.push(n); return n; },
      { initialProps: { talepler: [satir('a', SABAH)], anahtar: ANAHTAR, acik: true } });
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: true });
    expect(gorulen.length).toBeGreaterThanOrEqual(2);
    expect(gorulen.filter(n => n !== 0)).toEqual([]);
  });

  it('sekme açıkken sayfa yenilense de görülen talepler yeniden «yeni» sayılmaz (değer depoda)', () => {
    const talepler = [satir('a', SABAH), satir('b', OGLE)];
    kur({ talepler, anahtar: ANAHTAR, acik: true }).unmount();
    const { result } = kur({ talepler, anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(0);
  });

  it('`olusturma`\'sı çözülemeyen talep sekme açılıp kapansa da sayaca GİRMEZ ve saklanan değeri bozmaz', () => {
    const { result, rerender } = kur({ talepler: [satir('x', 'bozuk')], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(0);
    rerender({ talepler: [satir('x', 'bozuk')], anahtar: ANAHTAR, acik: true });
    expect(localStorage.getItem(ANAHTAR)).toBeNull();
    rerender({ talepler: [satir('x', 'bozuk'), satir('a', SABAH)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(1);
  });

  it('depolama KAPALIYKEN (fırlatıyor) sayaç bu oturumda bellekten çalışır', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const { result, rerender } = kur({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(2);
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: true });
    expect(result.current).toBe(0);
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE), satir('c', AKSAM)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(1);
  });

  it('anahtar yokken (kiracı / kullanıcı bilinmiyor) depoya HİÇBİR ŞEY yazılmaz; sayaç bellekten çalışır', () => {
    const { result, rerender } = kur({ talepler: [satir('a', SABAH)], anahtar: null, acik: true });
    expect(result.current).toBe(0);
    expect(localStorage.length).toBe(0);
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: null, acik: false });
    expect(result.current).toBe(1);
  });

  it('başka kimliğin bellekteki «gördüm»ü bu kimliğe UYGULANMAZ (kiracı / kullanıcı değişti)', () => {
    const DIGER = 'cetpa:magazaTalepSonGorulen:kiraci-2:uid-9';
    const talepler = [satir('a', SABAH), satir('b', OGLE)];
    const { result, rerender } = kur({ talepler, anahtar: ANAHTAR, acik: true });
    expect(result.current).toBe(0);
    rerender({ talepler, anahtar: DIGER, acik: false });
    expect(result.current).toBe(2);
    expect(localStorage.getItem(DIGER)).toBeNull();
  });

  it('başka sekmenin yazdığı daha yeni değer geriye ÇEKİLMEZ', () => {
    localStorage.setItem(ANAHTAR, String(ms(AKSAM)));
    kur({ talepler: [satir('a', SABAH)], anahtar: ANAHTAR, acik: true });
    expect(localStorage.getItem(ANAHTAR)).toBe(String(ms(AKSAM)));
  });
});
