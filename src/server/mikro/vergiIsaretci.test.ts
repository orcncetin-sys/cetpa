/**
 * vergiIsaretci.test.ts — oran → Mikro vergi işaretçisi TERS araması (Faz 3 3/n hakem
 * bulgusu, 2026-09-19). ÖNCE YAZILDI (modül yokken kırmızı görüldü).
 *
 * NEDEN TEK DOSYA: aynı ters arama ÜÇ gövde modülünde ÜÇ FARKLI eşitlik kuralıyla
 * kopyalanmıştı — `deger === o` (govdeStokCari), `Math.abs(fark) > 1e-9`
 * (govdeFaturaIrsaliye), `> 1e-6` (govdeSiparis). Sonuç: Mikro'nun VergiListesiV2
 * tablosu %20'yi 19.999999999 diye döndürdüğünde AYNI sipariş SiparisKaydetV2'den
 * geçerken faturası "%20 oranı Mikro vergi tablosunda yok" ile 400 alıyordu. Üç
 * yüzeyin üçü de tek yardımcıya bağlandı; tolerans BURADA kilitli.
 */
import { describe, it, expect } from 'vitest';
import { vergiIsaretcisiCoz, VERGI_ORAN_TOLERANSI } from './vergiIsaretci';

/** Müşterinin gerçek tablosu (2026-07-31 canlı bulgusu): sıra 4 = %20, sıra 3 = %10. */
const VERGI = new Map<number, number>([[1, 0], [2, 1], [3, 10], [4, 20]]);

describe('vergiIsaretcisiCoz — bilinen oran', () => {
  it('oranı tablodaki sıra numarasına çevirir (yüzde DEĞİL, işaretçi döner)', () => {
    expect(vergiIsaretcisiCoz(20, VERGI)).toBe(4);
    expect(vergiIsaretcisiCoz(10, VERGI)).toBe(3);
    expect(vergiIsaretcisiCoz(1, VERGI)).toBe(2);
  });

  it('%0 BİLİNEN bir orandır — `||` tuzağına düşüp null dönmez', () => {
    expect(vergiIsaretcisiCoz(0, VERGI)).toBe(1);
    expect(vergiIsaretcisiCoz(0, new Map([[5, 0]]))).toBe(5);
  });

  it('sayıya çevrilebilen metni kabul eder (Mikro alanları metin gelebiliyor)', () => {
    expect(vergiIsaretcisiCoz('10', VERGI)).toBe(3);
  });
});

describe('vergiIsaretcisiCoz — bilinmiyorsa null (çağıran throw eder, sabit 4 YAZMAZ)', () => {
  it('tabloda olmayan oran en yakınına YUVARLANMAZ', () => {
    expect(vergiIsaretcisiCoz(18, VERGI)).toBeNull();
  });

  it('boş tablo (VergiListesiV2 okunamadı) → null', () => {
    expect(vergiIsaretcisiCoz(20, new Map())).toBeNull();
  });

  it('sayı olmayan oran → null', () => {
    expect(vergiIsaretcisiCoz(undefined, VERGI)).toBeNull();
    expect(vergiIsaretcisiCoz(null, VERGI)).toBeNull();
    expect(vergiIsaretcisiCoz('yirmi', VERGI)).toBeNull();
    expect(vergiIsaretcisiCoz(NaN, VERGI)).toBeNull();
  });

  it('tablodaki çöp satırlar (sonsuz/NaN sıra ya da oran) atlanır, eşleşme sayılmaz', () => {
    expect(vergiIsaretcisiCoz(20, new Map([[NaN, 20]]))).toBeNull();
    expect(vergiIsaretcisiCoz(20, new Map([[4, NaN]]))).toBeNull();
    expect(vergiIsaretcisiCoz(Infinity, new Map([[4, Infinity]]))).toBeNull();
  });
});

describe('vergiIsaretcisiCoz — kayan nokta toleransı (üç kopyanın ayrıştığı yer)', () => {
  it('Mikro %20 yerine 19.9999999999 döndürse bile işaretçi bulunur', () => {
    // govdeStokCari'nin `deger === o` kopyası burada null dönüyordu: aynı ürün
    // siparişte geçip stok kartı/faturasında 400 alıyordu.
    expect(vergiIsaretcisiCoz(20, new Map([[4, 19.9999999999]]))).toBe(4);
    expect(vergiIsaretcisiCoz(19.9999999999, new Map([[4, 20]]))).toBe(4);
  });

  it('0.1 + 0.2 artığı (5.5e-17) eşleşmeyi bozmaz', () => {
    expect(vergiIsaretcisiCoz(0.1 + 0.2, new Map([[6, 0.3]]))).toBe(6);
  });

  it('GERÇEKTEN farklı oran tolerans yüzünden EŞLEŞMEZ (tolerans büyürse bu test kırılır)', () => {
    expect(vergiIsaretcisiCoz(20, new Map([[4, 20.001]]))).toBeNull();
    expect(vergiIsaretcisiCoz(20, new Map([[4, 19.99]]))).toBeNull();
  });

  it('tolerans kuruş oranlarından ÇOK küçük kalır (tek kaynak sabit)', () => {
    expect(VERGI_ORAN_TOLERANSI).toBeLessThanOrEqual(1e-6);
    expect(VERGI_ORAN_TOLERANSI).toBeGreaterThan(0);
  });
});

describe('vergiIsaretcisiCoz — belirlenimli seçim', () => {
  it('aynı oranı taşıyan birden çok sırada EN KÜÇÜK sıra seçilir (Map sırasından bağımsız)', () => {
    expect(vergiIsaretcisiCoz(20, new Map([[9, 20], [4, 20]]))).toBe(4);
    expect(vergiIsaretcisiCoz(20, new Map([[4, 20], [9, 20]]))).toBe(4);
  });
});
