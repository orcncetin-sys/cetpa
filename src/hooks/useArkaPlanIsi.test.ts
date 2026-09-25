/**
 * useArkaPlanIsi.test.ts — `jobs/<isAdi>` okuma kancası + başlatma yanıtı yorumlayıcısı + "Tümünü Çek"
 * sıralayıcısı (mikro-import-arkaplan istemci şartnamesi §0 ÖNCELİK / §B1, 2026-09-24). ÖNCE YAZILDI.
 *
 * Neden: Stok/Cari İçeri Al ve 12 SQL ucu artık anında `{ started, job }` dönüyor; iş `jobs/<isAdi>`
 * dokümanında sürüyor. Kilit GLOBAL tek iş (K-C): "Tümünü Çek" her adımın BİTİŞİNİ beklemezse 2. adımdan
 * itibaren hepsi `alreadyRunning` alır ve sıra sessizce hiçbir şey çekmez. Yanıt yorumu TEK tabloda
 * (`baslatmaYanitiniYorumla`) — kart ve sıralayıcı aynı fonksiyonu çağırır (kopya yasak).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useArkaPlanIsi, baslatmaYanitiniYorumla, isiBaslatVeBekle, TUMUNU_CEK_ADIM_ZAMAN_ASIMI_MS,
  IsZamanAsimiHatasi, BaskaIsKosuyorHatasi,
} from './useArkaPlanIsi';
import { yayinla, hataYayinla, sifirla, abonelikBirakildi, dinleyiciSayisi } from './useArkaPlanIsi.testDuzenegi';
import type { MikroIsBaslatmaYaniti } from '../services/mikroService';

vi.mock('../lib/dbClient', async () => (await import('./useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);

const IS = 'mikroImport-stok';
const T0 = { _seconds: 1_700_000_000, _nanoseconds: 0 };   // ham SSE zarfı — zamanMs okur
const T1 = { _seconds: 1_700_000_900, _nanoseconds: 0 };
/** Mikro görevlerin (ilk anlık görüntü, `await baslat()`) işlenmesi için birkaç tur. */
const bekleMikro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeEach(sifirla);
afterEach(() => vi.useRealTimers());

describe('useArkaPlanIsi — jobs/<isAdi> canlı okuma', () => {
  it('doküman yok → is:null, okumaHatasi:null ("hiç koşmadı" ≠ "okuyamadım")', async () => {
    const { result } = renderHook(() => useArkaPlanIsi(IS));
    await act(bekleMikro);
    expect(result.current).toEqual({ is: null, okumaHatasi: null });
  });

  it('yayın → is dolu (processed 3, total 10); alanlar olduğu gibi', async () => {
    const { result } = renderHook(() => useArkaPlanIsi(IS));
    await act(async () => { yayinla(IS, { running: true, processed: 3, total: 10 }); });
    expect(result.current.is?.processed).toBe(3);
    expect(result.current.is?.total).toBe(10);
    expect(result.current.is?.running).toBe(true);
  });

  it('hata geri çağrısı BOŞ DEĞİL: okumaHatasi dolar (eski panel `() => {}` ile yutuyordu)', async () => {
    const { result } = renderHook(() => useArkaPlanIsi(IS));
    await act(bekleMikro);   // ilk görüntü geldi (doküman yok)
    await act(async () => { hataYayinla(IS, new Error('yetki yok')); });
    expect(result.current.okumaHatasi).toBe('yetki yok');
    expect(result.current.is).toBeNull();
  });

  it('unmount aboneliği bırakır (dinleyici sızmaz)', async () => {
    const { unmount } = renderHook(() => useArkaPlanIsi(IS));
    expect(dinleyiciSayisi(IS)).toBe(1);
    unmount();
    expect(dinleyiciSayisi(IS)).toBe(0);
  });
});

describe('baslatmaYanitiniYorumla — §0 ÖNCELİK tablosu (ilk eşleşen kazanır)', () => {
  const y = (v: MikroIsBaslatmaYaniti) => baslatmaYanitiniYorumla(v, IS, true);

  it('0 notConfigured → hata "Mikro yapılandırılmamış."', () => {
    expect(y({ success: false, notConfigured: true })).toEqual({ tur: 'hata', metin: 'Mikro yapılandırılmamış.' });
  });
  it('1 !success → hata = error (HTTP 502 ham gövde yolu)', () => {
    expect(y({ success: false, error: 'HTTP 502' })).toEqual({ tur: 'hata', metin: 'HTTP 502' });
  });
  it('2 started && job !== isAdi → hata "İş adı uyuşmadı: baska ≠ mikroImport-stok" (sözleşme ihlali)', () => {
    expect(y({ success: true, started: true, job: 'baska' })).toEqual({ tur: 'hata', metin: 'İş adı uyuşmadı: baska ≠ mikroImport-stok' });
  });
  it('2 started ama job YOK → yine uyuşmadı hatası', () => {
    const r = y({ success: true, started: true });
    expect(r.tur).toBe('hata');
    expect(r.metin).toMatch(/İş adı uyuşmadı/);
  });
  it('3 alreadyRunning && job === isAdi → bekle, "Zaten çalışıyor — ilerleme aşağıda."', () => {
    expect(y({ success: true, started: false, alreadyRunning: true, job: IS })).toEqual({ tur: 'bekle', metin: 'Zaten çalışıyor — ilerleme aşağıda.' });
  });
  it('4 alreadyRunning && job !== isAdi → bilgi "Başka bir iş çalışıyor: mikroImport-cari — bitince deneyin." (HATA DEĞİL)', () => {
    expect(y({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-cari' }))
      .toEqual({ tur: 'bilgi', metin: 'Başka bir iş çalışıyor: mikroImport-cari — bitince deneyin.' });
  });
  it('4 job boşsa ad basılmaz', () => {
    const r = y({ success: true, started: false, alreadyRunning: true });
    expect(r.tur).toBe('bilgi');
    expect(r.metin).toBe('Başka bir iş çalışıyor — bitince deneyin.');
  });
  it('5 started && job === isAdi → bekle, metin null', () => {
    expect(y({ success: true, started: true, job: IS })).toEqual({ tur: 'bekle', metin: null });
  });
  it('6 hiçbiri (success:true, ne started ne alreadyRunning) → hata "Beklenmeyen başlatma yanıtı"', () => {
    expect(y({ success: true })).toEqual({ tur: 'hata', metin: 'Beklenmeyen başlatma yanıtı' });
  });
  it('öncelik: notConfigured + alreadyRunning(job:x) → 0 kazanır (hata), 4 değil', () => {
    expect(y({ success: false, notConfigured: true, alreadyRunning: true, job: 'x' }).tur).toBe('hata');
  });
  it('tr:false → EN metinler, TR dizgesinden FARKLI (7 satırın dolu metinleri)', () => {
    const vakalar: MikroIsBaslatmaYaniti[] = [
      { success: false, notConfigured: true },
      { success: true, started: true, job: 'baska' },
      { success: true, started: false, alreadyRunning: true, job: IS },
      { success: true, started: false, alreadyRunning: true, job: 'mikroImport-cari' },
      { success: true },
    ];
    for (const v of vakalar) {
      const tr = baslatmaYanitiniYorumla(v, IS, true), en = baslatmaYanitiniYorumla(v, IS, false);
      expect(en.tur).toBe(tr.tur);
      expect(en.metin).not.toBe(tr.metin);
    }
  });
});

describe('isiBaslatVeBekle — Tümünü Çek adımı işin BİTİŞİNİ bekler', () => {
  const basarili = (): Promise<MikroIsBaslatmaYaniti> => Promise.resolve({ success: true, started: true, job: IS });
  /** Sözün ÇÖZÜLDÜ mü/REDDEDİLDİ mi izleyicisi — bekleme iddiası için (`await` asılı kalırdı). */
  const izle = (p: Promise<unknown>) => {
    const d = { cozuldu: false, reddedildi: false, hata: null as unknown };
    p.then(() => { d.cozuldu = true; }, e => { d.reddedildi = true; d.hata = e; });
    return d;
  };

  it('önceki finishedAt T0 varken: running:true çözmez, running:false + finishedAt T1 çözer', async () => {
    yayinla(IS, { running: false, finishedAt: T0, processed: 100, total: 100 });
    const baslat = vi.fn(basarili);
    const p = isiBaslatVeBekle(IS, baslat, { tr: true });
    const d = izle(p);
    await bekleMikro();
    expect(baslat).toHaveBeenCalledTimes(1);
    yayinla(IS, { running: true, finishedAt: null, processed: 0 });
    await bekleMikro();
    expect(d.cozuldu).toBe(false);
    // ESKİ koşunun aynısı tekrar gelse (bayat SSE) yine çözmez — referans T0
    yayinla(IS, { running: false, finishedAt: T0, processed: 100, total: 100 });
    await bekleMikro();
    expect(d.cozuldu).toBe(false);
    yayinla(IS, { running: false, finishedAt: T1, processed: 2384, total: 2384 });
    await expect(p).resolves.toMatchObject({ running: false, processed: 2384 });
    expect(abonelikBirakildi).toHaveBeenCalledWith(IS);
  });

  // Hakem bulgusu (2026-09-25): referans yanıt gelene kadar HER görüntüde yeniden yazılıyordu. Küçük tabloda
  // (kasa/banka/depo) iş, IIS/ARR'de gecikmiş HTTP yanıtından ÖNCE biter ve running:true + bitiş(T1) SSE
  // olayları önce işlenirse referans T1 olur, bitiş hiç tanınmaz: 30 dk sonra başarılı adım "hatalı" sayılır.
  describe('iş HTTP yanıtından ÖNCE biterse (referans yalnız İLK görüntü)', () => {
    /** Yanıtı testin elle verdiği `baslat` — SSE olayları yanıttan önce işlenebilsin. */
    const elleYanit = () => {
      const k: { ver: (y: MikroIsBaslatmaYaniti) => void } = { ver: () => {} };
      const baslat = () => new Promise<MikroIsBaslatmaYaniti>(r => { k.ver = r; });
      return { k, baslat };
    };

    it('running:true + bitiş(T1) yanıttan önce geldi → yanıt gelince HEMEN çözer, zamanlayıcı kalmaz', async () => {
      vi.useFakeTimers();
      yayinla(IS, { running: false, finishedAt: T0, processed: 100 });
      const { k, baslat } = elleYanit();
      const p = isiBaslatVeBekle(IS, baslat, { tr: true });
      const d = izle(p);
      await bekleMikro();   // ilk görüntü (T0) = referans
      yayinla(IS, { running: true, finishedAt: null });
      yayinla(IS, { running: false, finishedAt: T1, processed: 7 });
      await bekleMikro();
      expect(d.cozuldu).toBe(false);   // yanıt yok: karar verilmez (hata/bilgi yanıtı da gelebilirdi)
      k.ver({ success: true, started: true, job: IS });
      await bekleMikro();
      expect(d.cozuldu).toBe(true);
      await expect(p).resolves.toMatchObject({ running: false, processed: 7 });
      expect(vi.getTimerCount()).toBe(0);   // 30 dk zamanlayıcı ya kurulmadı ya temizlendi
      expect(abonelikBirakildi).toHaveBeenCalledTimes(1);
    });

    it('yanıttan önce gelen bitiş error taşıyorsa → yanıt gelince reject error', async () => {
      yayinla(IS, { running: false, finishedAt: T0 });
      const { k, baslat } = elleYanit();
      const p = isiBaslatVeBekle(IS, baslat, { tr: true });
      await bekleMikro();
      yayinla(IS, { running: true, finishedAt: null });
      yayinla(IS, { running: false, error: 'Mikro 30sn', finishedAt: T1 });
      await bekleMikro();
      k.ver({ success: true, started: true, job: IS });
      await expect(p).rejects.toThrow('Mikro 30sn');
    });

    it('yanıttan önce ESKİ koşunun aynısı (T0) yeniden gelirse çözmez — referans ilk görüntü; sonra T1 çözer', async () => {
      yayinla(IS, { running: false, finishedAt: T0 });
      const { k, baslat } = elleYanit();
      const p = isiBaslatVeBekle(IS, baslat, { tr: true });
      const d = izle(p);
      await bekleMikro();
      yayinla(IS, { running: false, finishedAt: T0 });   // bayat tekrar (başka bir jobs dokümanının olayı da aynı görüntüyü üretir)
      await bekleMikro();
      k.ver({ success: true, started: true, job: IS });
      await bekleMikro();
      expect(d.cozuldu).toBe(false);
      expect(d.reddedildi).toBe(false);
      yayinla(IS, { running: false, finishedAt: T1 });
      await expect(p).resolves.toMatchObject({ running: false });
    });

    it('yanıt hata ise yanıttan önce görülen bitiş ÇÖZMEZ — başlatma hatası kazanır', async () => {
      yayinla(IS, { running: false, finishedAt: T0 });
      const { k, baslat } = elleYanit();
      const p = isiBaslatVeBekle(IS, baslat, { tr: true });
      await bekleMikro();
      yayinla(IS, { running: false, finishedAt: T1 });
      await bekleMikro();
      k.ver({ success: false, error: 'Bakım kilidi: lead-birlestir' });
      await expect(p).rejects.toThrow('Bakım kilidi: lead-birlestir');
    });
  });

  it('bitişte error dolu → reject error metniyle (Tümünü Çek adımı hatalı sayar)', async () => {
    yayinla(IS, { running: false, finishedAt: T0 });
    const p = isiBaslatVeBekle(IS, basarili, { tr: true });
    await bekleMikro();
    yayinla(IS, { running: false, error: 'x', finishedAt: T1 });
    await expect(p).rejects.toThrow('x');
  });

  it('started ama job "baska" → reject "İş adı uyuşmadı" (başka dokümana ABONE OLMAZ, abonelik kapanır)', async () => {
    const p = isiBaslatVeBekle(IS, () => Promise.resolve({ success: true, started: true, job: 'baska' }), { tr: true });
    await expect(p).rejects.toThrow(/İş adı uyuşmadı: baska ≠ mikroImport-stok/);
    expect(abonelikBirakildi).toHaveBeenCalledTimes(1);
    expect(dinleyiciSayisi('baska')).toBe(0);
  });

  it('alreadyRunning && job === isAdi → BEKLER; bitiş yayını çözer', async () => {
    yayinla(IS, { running: true, finishedAt: null });
    const p = isiBaslatVeBekle(IS, () => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: IS }), { tr: true });
    const d = izle(p);
    await bekleMikro();
    expect(d.cozuldu).toBe(false);
    expect(d.reddedildi).toBe(false);
    yayinla(IS, { running: false, finishedAt: T1 });
    await expect(p).resolves.toMatchObject({ running: false });
  });

  it('(iii) alreadyRunning && job BAŞKA → HEMEN reject "Başka bir iş çalışıyor: mikroImport-cari"; yayın yok, zamanlayıcı ilerletilmedi, abonelik 1 kez bırakıldı', async () => {
    vi.useFakeTimers();
    const p = isiBaslatVeBekle(IS, () => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-cari' }), { tr: true });
    await expect(p).rejects.toThrow('Başka bir iş çalışıyor: mikroImport-cari — bitince deneyin.');
    // Ayrı sınıf + iş adı: Tümünü Çek bununla sırayı durdurur (delta hakem 2026-09-25).
    await expect(p).rejects.toBeInstanceOf(BaskaIsKosuyorHatasi);
    await expect(p).rejects.toMatchObject({ job: 'mikroImport-cari' });
    expect(abonelikBirakildi).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);   // 30 dk zamanlayıcı hiç kurulmadı
  });

  it('notConfigured → reject "Mikro yapılandırılmamış."', async () => {
    await expect(isiBaslatVeBekle(IS, () => Promise.resolve({ success: false, notConfigured: true }), { tr: true }))
      .rejects.toThrow('Mikro yapılandırılmamış.');
  });

  it('baslat() kendisi reject ederse (mikroIsAdi throw / ağ) → aynı hatayla reject, abonelik bırakılır', async () => {
    await expect(isiBaslatVeBekle(IS, () => Promise.reject(new Error('rota değil')), { tr: true })).rejects.toThrow('rota değil');
    expect(abonelikBirakildi).toHaveBeenCalledTimes(1);
  });

  it('zaman aşımı (sahte zamanlayıcı): bitiş gelmezse "İş N dk içinde bitmedi" ile reject; varsayılan 30 dk', async () => {
    vi.useFakeTimers();
    expect(TUMUNU_CEK_ADIM_ZAMAN_ASIMI_MS).toBe(30 * 60_000);
    const p = isiBaslatVeBekle(IS, basarili, { tr: true, zamanAsimiMs: 2 * 60_000 });
    const d = izle(p);
    await bekleMikro();
    yayinla(IS, { running: true, finishedAt: null });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(d.reddedildi).toBe(true);
    expect(String((d.hata as Error).message)).toMatch(/İş 2 dk içinde bitmedi/);
    expect(d.hata).toBeInstanceOf(IsZamanAsimiHatasi);   // Tümünü Çek bu sınıfla sırayı durdurur
    expect(abonelikBirakildi).toHaveBeenCalledTimes(1);
  });
});
