import { describe, it, expect } from 'vitest';
import { belgeNoMetni, yanitAnahtarYollari } from './belgeNo';

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

describe('yanitAnahtarYollari — İkiz ölçümü (I2): Mikro yanıtının ANAHTAR yolları, DEĞER ASLA', () => {
  const ZARF = { result: [{ IsError: false, Data: { faturaNo: 'FTR-0000731', ettn: 'aa11-bb22-cc33', sira: 90417 } }] };

  it('zarfın yollarını verir: her seviyede yapraklar önce, sonra dallar (sıralı); dizide ilk öğe [0]', () => {
    expect(yanitAnahtarYollari(ZARF)).toEqual([
      'result[0].IsError', 'result[0].Data.ettn', 'result[0].Data.faturaNo', 'result[0].Data.sira',
    ]);
  });

  it('DEĞER sızmaz: numara, ETTN ve sayı çıktıda YOK', () => {
    const metin = JSON.stringify(yanitAnahtarYollari(ZARF));
    for (const deger of ['FTR-0000731', 'aa11-bb22-cc33', '90417', 'false']) expect(metin).not.toContain(deger);
  });

  it('satır düzeyi (Data[0].evraklar[0].detay[0].sth_evrakno_sira) varsayılan derinlikte görünür — dizi dalı erken kesmez', () => {
    expect(yanitAnahtarYollari({ result: [{ Data: [{ evraklar: [{ seri: 'F', detay: [{ sth_evrakno_sira: 1 }] }] }] }] }))
      .toContain('result[0].Data[0].evraklar[0].detay[0].sth_evrakno_sira');
  });

  it('toplu gövde yanıtı (Data.evraklar[0] / Data[0].evraklar[0]) varsayılan derinlikte SIRAYA kadar görünür', () => {
    expect(yanitAnahtarYollari({ result: [{ IsError: false, Data: { evraklar: [{ seri: 'F', sira: 1 }] } }] }))
      .toContain('result[0].Data.evraklar[0].sira');
    expect(yanitAnahtarYollari({ result: [{ Data: [{ evraklar: [{ belge: { sira: 1 } }] }] }] }))
      .toContain('result[0].Data[0].evraklar[0].belge.sira');
  });

  it('boş dizi/nesne işaretlenir; ilkel kök ve null boş liste', () => {
    expect(yanitAnahtarYollari({ result: [] })).toEqual(['result[]']);
    expect(yanitAnahtarYollari({ result: [{ Data: {} }] })).toEqual(['result[0].Data{}']);
    expect(yanitAnahtarYollari(null)).toEqual([]);
    expect(yanitAnahtarYollari('Api Server Error')).toEqual([]);
    expect(yanitAnahtarYollari({ a: null })).toEqual(['a']);
  });

  it('derinlik sınırına gelen dal İŞARETLİ ({…} / […]) — yaprak sanılmaz', () => {
    expect(yanitAnahtarYollari({ a: { b: { c: { d: { e: 1 } } } } }, 60, 3)).toEqual(['a.b.c{…}']);
    expect(yanitAnahtarYollari({ a: { b: [{ c: 1 }] } }, 60, 2)).toEqual(['a.b[…]']);
  });

  it('iç içe DİZİDE de derinlik uygulanır (kök dahil) — çok derin dizi yığını taşırmaz', () => {
    expect(yanitAnahtarYollari([[[[{ a: 1 }]]]], 60, 2)).toEqual(['[0][0][…]']);
    expect(yanitAnahtarYollari({ r: [[[{ a: 1 }]]] }, 60, 3)).toEqual(['r[0][0][…]']);
    let derin: unknown = { a: 1 };
    for (let i = 0; i < 20000; i++) derin = [derin];
    expect(() => yanitAnahtarYollari({ result: derin })).not.toThrow();
    expect(yanitAnahtarYollari({ result: derin }).at(-1)).toMatch(/\[…\]$/);
  });

  it('kaçak büyüklük koruması: sayım 5000\'de durur, işaret alt sınır olduğunu söyler (+)', () => {
    const g = Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`k${String(i).padStart(4, '0')}`, 1]));
    const y = yanitAnahtarYollari(g);
    expect(y).toHaveLength(61);
    expect(y.at(-1)).toBe('…(+4941+ yol kırpıldı)');
  });

  it('yol sınırı SESSİZ değil: son öğe kırpma işareti; zarf alanı (IsError) büyük Data dalının arkasında düşmez', () => {
    const data = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`sth_a${String(i).padStart(2, '0')}`, 1]));
    const y = yanitAnahtarYollari({ result: [{ IsError: false, ErrorMessage: null, Data: { ...data, sth_evrakno_sira: 5 } }] });
    expect(y).toHaveLength(61);
    expect(y[0]).toBe('result[0].ErrorMessage');
    expect(y).toContain('result[0].IsError');
    expect(y[60]).toBe('…(+13 yol kırpıldı)');
    expect(yanitAnahtarYollari({ [`${'x'.repeat(50)}`]: 1 })[0]).toBe('x'.repeat(40) + '…');
  });
});
