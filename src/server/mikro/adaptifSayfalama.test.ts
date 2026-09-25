/**
 * adaptifSayfalama.test.ts — Mikro liste sayfalarını daraltarak toplama (mikro-import-arkaplan,
 * 2026-09-24). ÖNCE YAZILDI.
 *
 * Gövde `mikroRoutes.ts` import/stok'tan (eski `collectRange`, 709-727) çıkarıldı; cari import'u
 * da bunu kullanır. Yeni olan tek şey: ZAMAN AŞIMI ayrı sayılır — tek kayıtlık zaman aşımı
 * "bozuk kayıt" değildir (Mikro tarafında kalıcı bozukluk ≠ geçici ağ/yük), özet yalan söylemesin.
 */
import { describe, it, expect } from 'vitest';
import {
  araligiTopla, zamanAsimiMi, ALT_STOK, ALT_CARI, MikroYanitVermiyorHatasi, MikroVeriVermiyorHatasi,
  type Getir, type SayfaSayaclari,
} from './adaptifSayfalama';

const sayac = (): SayfaSayaclari => ({ bozukKayit: 0, zamanAsimiSayfa: 0, zamanAsimiKayit: 0 });
const zamanAsimi = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

describe('zamanAsimiMi — Node 24 fetch iptali DOMException name=TimeoutError', () => {
  it('TimeoutError → true; sıradan Error / ECONNREFUSED / null → false', () => {
    expect(zamanAsimiMi(zamanAsimi())).toBe(true);
    expect(zamanAsimiMi(new Error('ağ'))).toBe(false);
    expect(zamanAsimiMi(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }))).toBe(false);
    expect(zamanAsimiMi(null)).toBe(false);
    expect(zamanAsimiMi('TimeoutError')).toBe(false);
  });
});

describe('araligiTopla — daraltma paritesi (100 → 20 → 5 → 1)', () => {
  it('düz sayfa başarılıysa tek çağrı; end = rows.length < size', async () => {
    const cagrilar: Array<[number, number]> = [];
    const getir: Getir = async (o, s) => { cagrilar.push([o, s]); return Array.from({ length: 40 }, (_, i) => ({ i: o + i })); };
    const s = sayac();
    const r = await araligiTopla(getir, 200, 100, ALT_STOK, s);
    expect(r.rows).toHaveLength(40);
    expect(r.end).toBe(true);
    expect(cagrilar).toEqual([[200, 100]]);
    expect(s).toEqual({ bozukKayit: 0, zamanAsimiSayfa: 0, zamanAsimiKayit: 0 });
  });

  it("`null` (Api Server Error) tek kayıtta → bozukKayit++; diğer kayıtlar toplanır (eski 714 paritesi)", async () => {
    // 7. kayıt bozuk: 100'lük, [0,20), [5,10) ve tekil 7 null döner; kalan aralıklar dolu gelir.
    const bozuk = (o: number, s: number) => o <= 7 && 7 < o + s;
    const getir: Getir = async (o, s) => bozuk(o, s) ? null : Array.from({ length: s }, (_, i) => ({ i: o + i }));
    const s = sayac();
    const r = await araligiTopla(getir, 0, 100, ALT_STOK, s);
    expect(r.rows).toHaveLength(99);
    expect(r.rows.some(x => x.i === 7)).toBe(false);
    expect(s).toEqual({ bozukKayit: 1, zamanAsimiSayfa: 0, zamanAsimiKayit: 0 });
  });

  it('ZAMAN AŞIMI tek kayıtta → zamanAsimiKayit++ (bozukKayit\'e KARIŞMAZ); her zaman aşan sayfa zamanAsimiSayfa\'ya girer', async () => {
    const asili = (o: number, s: number) => o <= 7 && 7 < o + s;
    const getir: Getir = async (o, s) => { if (asili(o, s)) throw zamanAsimi(); return Array.from({ length: s }, (_, i) => ({ i: o + i })); };
    const s = sayac();
    const r = await araligiTopla(getir, 0, 100, ALT_STOK, s);
    expect(r.rows).toHaveLength(99);
    // 100'lük + [0,20) + [5,10) + tekil 7 = 4 zaman aşan çağrı; kaybolan kayıt 1; bozuk 0.
    expect(s).toEqual({ bozukKayit: 0, zamanAsimiSayfa: 4, zamanAsimiKayit: 1 });
  });

  it('zaman aşımı OLMAYAN throw (ECONNREFUSED) yeniden fırlatılır — daraltma ölü ağı iyileştirmez, 100 "bozuk" saymaz', async () => {
    const getir: Getir = async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); };
    const s = sayac();
    await expect(araligiTopla(getir, 0, 100, ALT_STOK, s)).rejects.toThrow(/ECONNREFUSED/);
    expect(s).toEqual({ bozukKayit: 0, zamanAsimiSayfa: 0, zamanAsimiKayit: 0 });
  });

  it("`end` son alt-aralığın end'idir (723 paritesi): bozuk 100'lük sayfanın son 20'liği kısa dönerse end=true", async () => {
    const getir: Getir = async (o, s) => {
      if (s === 100) return null;
      if (s === 20 && o === 80) return [{ i: 80 }, { i: 81 }];   // 2 < 20 → liste bitti
      return Array.from({ length: s }, (_, i) => ({ i: o + i }));
    };
    const s = sayac();
    const r = await araligiTopla(getir, 0, 100, ALT_STOK, s);
    expect(r.end).toBe(true);
    expect(r.rows).toHaveLength(82);
  });

  it('ALT_CARI 500 → 100 → 20 → 5 → 1; tanınmayan sayfa boyu throw (sonsuz döngü/NaN yerine)', async () => {
    expect(ALT_CARI).toEqual({ 500: 100, 100: 20, 20: 5, 5: 1 });
    expect(ALT_STOK).toEqual({ 100: 20, 20: 5, 5: 1 });
    const getir: Getir = async () => null;
    await expect(araligiTopla(getir, 0, 50, ALT_STOK, sayac())).rejects.toThrow(/50/);
  });
});

// Hakem 2026-09-25 (kritik): zaman aşımında daraltma VAR ama devre kesici YOKTU. Mikro bağlantıyı
// kabul edip yanıt vermezse (2026-08-24 kesintisi: "TLS el sıkışıyor, TTFB gelmiyor") her çağrı
// listeZamanAsimiMs()'te düşer, tek kayıtlık zaman aşımı end:false döndüğü için rota döngüsü 50.000'e
// kadar sürer: stok CHUNK başına 126 çağrı × 120 sn ≈ 4,2 saat, 500 CHUNK ≈ 2.100 saat — süreç-geneli
// kilit o süre dolu, 15 import düğmesi alreadyRunning alır, iptal yolu yok.
describe('araligiTopla — DEVRE KESİCİ: Mikro yanıt vermiyorsa iş durur (çağrı sayısı SINIRLI)', () => {
  const hepAsili = () => {
    const cagrilar: Array<[number, number]> = [];
    const getir: Getir = async (o, s) => { cagrilar.push([o, s]); throw zamanAsimi(); };
    return { getir, cagrilar };
  };

  it('stok: HER çağrı TimeoutError → MikroYanitVermiyorHatasi ile reject; çağrı = zincir derinliği (100→20→5→1 = 4) + 1 = 5', async () => {
    const { getir, cagrilar } = hepAsili();
    const s = sayac();
    const hata = await araligiTopla(getir, 0, 100, ALT_STOK, s).then(() => null, (e: unknown) => e);
    expect(hata).toBeInstanceOf(MikroYanitVermiyorHatasi);
    expect(zamanAsimiMi(hata), 'dış daraltma onu TimeoutError sanıp yeniden denemesin').toBe(false);
    expect(String((hata as Error).message)).toMatch(/Mikro yanıt vermiyor: art arda 5 çağrı zaman aşımına uğradı/);
    expect(cagrilar).toEqual([[0, 100], [0, 20], [0, 5], [0, 1], [1, 1]]);
    // Yalıtılan ilk kayıt sayıldı; kesiciyi açan çağrı da zaman aşan çağrıdır.
    expect(s).toEqual({ bozukKayit: 0, zamanAsimiSayfa: 5, zamanAsimiKayit: 1 });
  });

  it('cari: 500→100→20→5→1 = 5 derinlik → 6. ardışık zaman aşımında durur', async () => {
    const { getir, cagrilar } = hepAsili();
    await expect(araligiTopla(getir, 1000, 500, ALT_CARI, sayac())).rejects.toBeInstanceOf(MikroYanitVermiyorHatasi);
    expect(cagrilar).toEqual([[1000, 500], [1000, 100], [1000, 20], [1000, 5], [1000, 1], [1001, 1]]);
  });

  it('TEK ağır kayıt en kötü yerde (her alt aralığın BAŞINDA) hâlâ yalıtılır — kesici AÇMAZ (derinlik kadar ardışık zaman aşımı meşru)', async () => {
    const agir = (o: number, s: number) => o <= 0 && 0 < o + s;
    const getir: Getir = async (o, s) => { if (agir(o, s)) throw zamanAsimi(); return Array.from({ length: s }, (_, i) => ({ i: o + i })); };
    const stok = sayac();
    const r = await araligiTopla(getir, 0, 100, ALT_STOK, stok);
    expect(r.rows).toHaveLength(99);
    expect(stok).toEqual({ bozukKayit: 0, zamanAsimiSayfa: 4, zamanAsimiKayit: 1 });
    const cari = sayac();
    expect((await araligiTopla(getir, 0, 500, ALT_CARI, cari)).rows).toHaveLength(499);
    expect(cari).toEqual({ bozukKayit: 0, zamanAsimiSayfa: 5, zamanAsimiKayit: 1 });
  });

  it('VERİ taşıyan yanıt ardışık sayaçları sıfırlar: veriyle serpiştirilmiş zaman aşımları kesiciyi açmaz', async () => {
    // Tek kayıtlar dönüşümlü: çift offset zaman aşar, tek offset tek satır döner (servis ayakta, veri geliyor).
    const getir: Getir = async (o, s) => {
      if (s > 1) throw zamanAsimi();
      if (o % 2 === 0) throw zamanAsimi();
      return [{ i: o }];
    };
    const s = sayac();
    const r = await araligiTopla(getir, 0, 20, ALT_STOK, s);
    expect(r.rows).toHaveLength(10);
    expect(s.zamanAsimiKayit).toBe(10);
    expect(s.bozukKayit).toBe(0);
  });
});

// Delta hakem 2026-09-25 (bulgu 6, CONFIRMED/kritik): devre kesici YALNIZ TimeoutError'ı sayıyordu; `null`
// yanıtı (IsError, HTTP 5xx, stub/kilit olayı, düz metin) `ardisik = 0` ile servisi "ayakta" sayıyordu.
// ÖLÇÜLDÜ (gerçek araligiTopla, hep null dönen getir): cari 100 sayfa × 631 = 63.100 Mikro çağrısı
// (HEAD'de `if (!ok) break;` → 1 çağrı), sonuç bozukKayit:50.000 + basarili:true = var olmayan 50.000
// kaydı "bozuk" sayan sahte kesinlik; süreç-geneli kilit saatlerce dolu.
describe('araligiTopla — VERİSİZ zincir kesicisi: Mikro sürekli null dönüyorsa iş durur (çağrı SINIRLI)', () => {
  const hepNull = () => {
    const cagrilar: Array<[number, number]> = [];
    const getir: Getir = async (o, s) => { cagrilar.push([o, s]); return null; };
    return { getir, cagrilar };
  };

  it('stok: HER çağrı null → MikroVeriVermiyorHatasi; çağrı = (derinlik 4 − 1) + yaprak grubu 5 + 1 = 9 (HEAD değil: 126 × 500 CHUNK)', async () => {
    const { getir, cagrilar } = hepNull();
    const s = sayac();
    const hata = await araligiTopla(getir, 0, 100, ALT_STOK, s).then(() => null, (e: unknown) => e);
    expect(hata).toBeInstanceOf(MikroVeriVermiyorHatasi);
    expect(zamanAsimiMi(hata), 'dış daraltma onu TimeoutError sanıp yeniden denemesin').toBe(false);
    expect(String((hata as Error).message)).toMatch(/^Mikro veri vermiyor: art arda 9 çağrı veri döndürmedi \(kayıt #5\)/);
    expect(cagrilar).toEqual([[0, 100], [0, 20], [0, 5], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 5]]);
    // Kesilmeden önce yalıtılan 5 tek kayıt sayıldı — 50.000 DEĞİL.
    expect(s).toEqual({ bozukKayit: 5, zamanAsimiSayfa: 0, zamanAsimiKayit: 0 });
  });

  it('cari: 500→100→20→5→1 → (5 − 1) + 5 + 1 = 10. çağrıda durur', async () => {
    const { getir, cagrilar } = hepNull();
    await expect(araligiTopla(getir, 1000, 500, ALT_CARI, sayac())).rejects.toBeInstanceOf(MikroVeriVermiyorHatasi);
    expect(cagrilar).toHaveLength(10);
    expect(cagrilar[9]).toEqual([1005, 5]);
  });

  it('en kötü yerde (grup başında) 5 BİTİŞİK bozuk kayıt TOLERE edilir (bir yaprak grubunun tamamı); 6. bitişik bozuk kesiciyi açar', async () => {
    const bozukKume = (k: number): Getir => async (o, s) =>
      (o < k ? null : Array.from({ length: s }, (_, i) => ({ i: o + i })));   // [0,k) bozuk: kapsayan her aralık null
    const bes = sayac();
    const r = await araligiTopla(bozukKume(5), 0, 100, ALT_STOK, bes);
    expect(r.rows).toHaveLength(95);
    expect(bes).toEqual({ bozukKayit: 5, zamanAsimiSayfa: 0, zamanAsimiKayit: 0 });
    await expect(araligiTopla(bozukKume(6), 0, 100, ALT_STOK, sayac())).rejects.toBeInstanceOf(MikroVeriVermiyorHatasi);
  });

  it('zaman aşımı ile null karışık (hiç VERİ yok) → kesici açılır: zaman aşımı sayacı null ile sıfırlanır ama verisiz sayaç SIFIRLANMAZ', async () => {
    const getir: Getir = async (o, s) => {
      if (s > 1) throw zamanAsimi();
      if (o % 2 === 0) throw zamanAsimi();
      return null;
    };
    await expect(araligiTopla(getir, 0, 20, ALT_STOK, sayac())).rejects.toBeInstanceOf(MikroVeriVermiyorHatasi);
  });

  it('boş liste (liste bitti) VERİ yanıtıdır — sayacı sıfırlar, end:true', async () => {
    const getir: Getir = async (o, s) => (o === 0 && s > 1 ? null : o < 3 ? null : []);
    const r = await araligiTopla(getir, 0, 100, ALT_STOK, sayac());
    expect(r.rows).toEqual([]);
  });
});
