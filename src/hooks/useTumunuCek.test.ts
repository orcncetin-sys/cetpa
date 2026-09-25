/**
 * useTumunuCek.test.ts — "Tümünü Çek" sırasının durumu BİLEŞEN DIŞINDA (delta hakem 2026-09-25, bulgu 9).
 * ÖNCE YAZILDI.
 *
 * Neden: döngü MikroSyncPanel'in yerel state'indeydi, iptal edilemiyordu ve her arka plan adımı artık işin
 * bitişini (≤ 30 dk) bekliyor. Panel unmount olunca döngü görünmeden sürüyor, geri dönüşte düğme yeniden
 * basılabiliyordu → İKİNCİ döngü: senkron uçlar birincinin koşan işiyle EŞZAMANLI Mikro'ya gidiyor, birincinin
 * özeti kayboluyordu. Sıra artık modül düzeyinde TEK; bileşen yalnız okur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { tumunuCekBaslat, tumunuCekSifirla, useTumunuCek, SirayiDurdurHatasi, type TumunuCekAdimi } from './useTumunuCek';

/** Dışarıdan çözülen adım. */
function elleAdim(ad: string) {
  let coz!: () => void; let reddet!: (e: unknown) => void;   // ! : Promise yapıcısı senkron atar
  const calistir = vi.fn(() => new Promise<void>((r, j) => { coz = r; reddet = j; }));
  return { adim: { ad, calistir } as TumunuCekAdimi, coz: () => coz(), reddet: (e: unknown) => reddet(e) };
}
const bekleMikro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeEach(() => tumunuCekSifirla());

describe('tumunuCekBaslat — sıra TEK, adımlar SIRAYLA, hata durdurmaz', () => {
  it('adım 2, adım 1 bitmeden çağrılmaz; hata özetine ad + metin yazılır; bitince calisiyor:false', async () => {
    const a = elleAdim('Stok kartları');
    const b = elleAdim('Cariler');
    const c = elleAdim('Mizan');
    const bitti = tumunuCekBaslat([a.adim, b.adim, c.adim]);
    expect(bitti).not.toBeNull();
    await bekleMikro();
    expect(a.adim.calistir).toHaveBeenCalledTimes(1);
    expect(b.adim.calistir).not.toHaveBeenCalled();
    a.coz();
    await bekleMikro();
    expect(b.adim.calistir).toHaveBeenCalledTimes(1);
    b.reddet(new Error('Başka bir iş çalışıyor: mikroImport-elle'));
    await bekleMikro();
    c.coz();
    await bitti;
    const { result } = renderHook(() => useTumunuCek());
    expect(result.current).toEqual({
      calisiyor: false, adim: null,
      ozet: { ok: 2, hatalar: [{ ad: 'Cariler', metin: 'Başka bir iş çalışıyor: mikroImport-elle' }] },
    });
  });

  it('koşarken İKİNCİ başlatma null döner — ikinci döngü YOK (adım bir kez çağrılır)', async () => {
    const a = elleAdim('Stok kartları');
    const ikinciAdim = elleAdim('Stok kartları');
    const bitti = tumunuCekBaslat([a.adim]);
    expect(tumunuCekBaslat([ikinciAdim.adim])).toBeNull();
    await bekleMikro();
    expect(ikinciAdim.adim.calistir).not.toHaveBeenCalled();
    a.coz();
    await bitti;
  });
});

describe('useTumunuCek — durum bileşen ömründen BAĞIMSIZ', () => {
  it('kanca unmount olup yeniden bağlanınca sıra SÜRÜYOR görünür (adım adı); bitince özet yeni kancada', async () => {
    const a = elleAdim('Stok kartları');
    const ilk = renderHook(() => useTumunuCek());
    let bitti: Promise<void> | null = null;
    act(() => { bitti = tumunuCekBaslat([a.adim]); });
    await act(bekleMikro);
    expect(ilk.result.current).toMatchObject({ calisiyor: true, adim: 'Stok kartları', ozet: null });
    ilk.unmount();
    const ikinci = renderHook(() => useTumunuCek());
    expect(ikinci.result.current).toMatchObject({ calisiyor: true, adim: 'Stok kartları' });
    await act(async () => { a.coz(); await bitti; });
    expect(ikinci.result.current).toEqual({ calisiyor: false, adim: null, ozet: { ok: 1, hatalar: [] } });
  });

  it('yeni sıra başlayınca ÖNCEKİ özet silinir (eski özet yeni koşuya aitmiş gibi durmaz)', async () => {
    const a = elleAdim('A');
    const ilkSira = tumunuCekBaslat([a.adim]);
    a.coz();
    await ilkSira;
    const { result } = renderHook(() => useTumunuCek());
    expect(result.current.ozet).toEqual({ ok: 1, hatalar: [] });
    const b = elleAdim('B');
    let ikinciSira: Promise<void> | null = null;
    act(() => { ikinciSira = tumunuCekBaslat([b.adim]); });
    expect(result.current).toMatchObject({ calisiyor: true, ozet: null });
    await act(async () => { b.coz(); await ikinciSira; });
  });

  it('tumunuCekSifirla (test dikişi): eski sıranın geç gelen güncellemeleri YOK sayılır', async () => {
    const a = elleAdim('A');
    const eski = tumunuCekBaslat([a.adim, elleAdim('B').adim]);
    tumunuCekSifirla();
    a.coz();
    await eski;
    const { result } = renderHook(() => useTumunuCek());
    expect(result.current).toEqual({ calisiyor: false, adim: null, ozet: null });
  });
});

// İnceleme bulgusu 2026-09-25 (CONFIRMED): sıra modül düzeyinde yaşar; çıkış + başka kullanıcıyla giriş sonrası
// kalan adımlar YENİ kullanıcının jetonuyla koşuyor, işler/denetim kaydı ona yazılıyordu.
describe('tumunuCekBaslat — oturum değişirse ve adım SirayiDurdurHatasi atarsa sıra DURUR', () => {
  it('kimlik adımlar arasında değişirse kalan adımlar KOŞMAZ; özet durduruldu {sebep:oturum, kalan}', async () => {
    let uid: string | null = 'u1';
    const a = elleAdim('A'); const b = elleAdim('B'); const c = elleAdim('C');
    const bitti = tumunuCekBaslat([a.adim, b.adim, c.adim], { kimlik: () => uid });
    await bekleMikro();
    uid = 'u2';                     // A koşarken çıkış + başka kullanıcıyla giriş
    a.coz();
    await bitti;
    expect(b.adim.calistir).not.toHaveBeenCalled();
    expect(c.adim.calistir).not.toHaveBeenCalled();
    const { result } = renderHook(() => useTumunuCek());
    expect(result.current).toEqual({ calisiyor: false, adim: null,
      ozet: { ok: 1, hatalar: [], durduruldu: { sebep: 'oturum', kalan: ['B', 'C'] } } });
  });

  it('çıkış (kimlik null) da durdurur; kimlik aynı kalırsa sıra sonuna kadar sürer (durduruldu alanı YOK)', async () => {
    let uid: string | null = 'u1';
    const a = elleAdim('A'); const b = elleAdim('B');
    const bitti = tumunuCekBaslat([a.adim, b.adim], { kimlik: () => uid });
    await bekleMikro();
    uid = null;
    a.coz();
    await bitti;
    expect(b.adim.calistir).not.toHaveBeenCalled();

    tumunuCekSifirla();
    const x = elleAdim('X'); const y = elleAdim('Y');
    const ikinci = tumunuCekBaslat([x.adim, y.adim], { kimlik: () => 'u1' });
    await bekleMikro(); x.coz(); await bekleMikro(); y.coz(); await ikinci;
    const { result } = renderHook(() => useTumunuCek());
    expect(result.current.ozet).toEqual({ ok: 2, hatalar: [] });
  });

  it('adım SirayiDurdurHatasi atarsa hata özete yazılır, SONRAKİ adımlar koşmaz; sıradan hata sırayı durdurmaz', async () => {
    const a = elleAdim('A'); const b = elleAdim('B'); const c = elleAdim('C'); const d = elleAdim('D');
    const bitti = tumunuCekBaslat([a.adim, b.adim, c.adim, d.adim]);
    await bekleMikro();
    a.reddet(new Error('HTTP 502'));           // sıradan hata: sürer
    await bekleMikro();
    expect(b.adim.calistir).toHaveBeenCalled();
    b.reddet(new SirayiDurdurHatasi('İş 30 dk içinde bitmedi'));
    await bitti;
    expect(c.adim.calistir).not.toHaveBeenCalled();
    expect(d.adim.calistir).not.toHaveBeenCalled();
    const { result } = renderHook(() => useTumunuCek());
    expect(result.current.ozet).toEqual({ ok: 0,
      hatalar: [{ ad: 'A', metin: 'HTTP 502' }, { ad: 'B', metin: 'İş 30 dk içinde bitmedi' }],
      durduruldu: { sebep: 'adim', kalan: ['C', 'D'] } });
  });
});
