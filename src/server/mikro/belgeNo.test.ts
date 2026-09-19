import { describe, it, expect } from 'vitest';
import { belgeNoMetni } from './belgeNo';

describe('belgeNoMetni — Mikro yanıtındaki evrak numarasının METİN karşılığı', () => {
  it('PARİTE: dolu metin olduğu gibi döner (kırpılmış)', () => {
    expect(belgeNoMetni('IRS2026000001042')).toBe('IRS2026000001042');
    expect(belgeNoMetni('  FTR-4471  ')).toBe('FTR-4471');
  });

  it('MUTASYON-AYIRT EDİCİ: SAYISAL numara metne çevrilir, sessizce DÜŞMEZ', () => {
    // Rota `(md?.evrakNo || md?.id || null) as string | null` yazıyordu; `as` yalnız derleme
    // zamanı dökümüdür, sayı JSON'da sayı kalır. İstemci numarayı yalnız `typeof === 'string'`
    // ise kabul ediyor (irsaliyeGonder `doluMetin`), yani sayısal numara sessizce düşüyor,
    // `orders.irsaliyeNo` hiç yazılmıyor ve rozet kalıcı olarak "numara gelmedi" diyordu —
    // oysa numara GELMİŞTİ (2026-09-19 kapanış bulgusu). Dönüşüm sunucuda, tek noktada.
    expect(belgeNoMetni(1042)).toBe('1042');
    expect(belgeNoMetni(1)).toBe('1');
  });

  it('numara YOKSA null — sahte numara uydurulmaz', () => {
    expect(belgeNoMetni(null)).toBeNull();
    expect(belgeNoMetni(undefined)).toBeNull();
    expect(belgeNoMetni('')).toBeNull();
    expect(belgeNoMetni('   ')).toBeNull();
  });

  it('BELGE NUMARASI OLAMAYACAK sayılar reddedilir (0, negatif, kesirli, sonsuz)', () => {
    // Mikro `Data: {}` dönünce `md?.id` gibi alanlar 0/NaN olabiliyor; "0" bir evrak numarası
    // değildir ve rozette gerçek numara gibi görünürdü.
    expect(belgeNoMetni(0)).toBeNull();
    expect(belgeNoMetni(-5)).toBeNull();
    expect(belgeNoMetni(10.5)).toBeNull();
    expect(belgeNoMetni(NaN)).toBeNull();
    expect(belgeNoMetni(Infinity)).toBeNull();
    expect(belgeNoMetni(Number.MAX_VALUE)).toBeNull();   // üstel gösterim evrak no değildir
  });

  it('sayı/metin dışı değerler reddedilir (boolean, nesne, dizi)', () => {
    expect(belgeNoMetni(true)).toBeNull();
    expect(belgeNoMetni(false)).toBeNull();
    expect(belgeNoMetni({})).toBeNull();
    expect(belgeNoMetni([])).toBeNull();
    expect(belgeNoMetni([1042])).toBeNull();             // `String([1042])` "1042" verirdi
  });

  it('ilkBelgeNo: yedek zincirinin İLK geçerli değerini verir', () => {
    expect(belgeNoMetni(undefined, null, 1042, 'ARD')).toBe('1042');
    expect(belgeNoMetni(undefined, null, 0, '')).toBeNull();
  });
});
