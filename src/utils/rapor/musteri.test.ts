/**
 * musteri.test.ts — müşteri KİMLİĞİ + müşteri özeti (Faz 3 6a, grup "musteri", 2026-09-19).
 * ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * ## Neden var
 * Rapor veri katmanında müşteri DÖRT yerde AD metniyle gruplanıyor (HEAD 46c53a8):
 *   - `components/reports/useReportsData.ts:215`  `topCustomers` anahtarı `o.customerName || '—'` (trim'siz)
 *   - `pages/RaporlarPage.tsx:187`                PDF "En Yüksek Cirolu Müşteriler" `custMap`
 *   - `pages/RaporlarPage.tsx:274`                Aylık Özet "yeni müşteri" `ilkSiparisAyi`
 *   - `pages/RaporlarPage.tsx:111`                sentetik Mikro siparişi — cari KODU hiçbir alana yazılmıyor
 * Sonuç: aynı adlı İKİ firma tek müşteri, adı iki türlü yazılmış TEK firma iki müşteri,
 * adsız siparişler ise '—' adlı SAHTE bir müşteri oluyordu.
 *
 * ## KULLANICI KARARI K4 (KARARLAR.md, 2026-09-19 ikinci tur — BAĞLAYICI), kullanıcının cümlesi:
 *   "Müşteriyi adla mı kimlikle mi gruplayacağız → kimlikle."
 * (Plan önerisi "ad öncelikli" REDDEDİLDİ.) Testler bu kararın ÖLÇÜSÜDÜR: test 2 ve 9 mutasyonu
 * (ad öncelikli anahtar) KIRMIZI olmalıdır.
 *
 * ## Parite
 * Tek kimlikli, adı tutarlı müşteride sayı eski ad-anahtarlı `reduce` ile BİREBİR (test 1).
 * BİLİNÇLİ FARKLAR (hepsi K4 gereği) test 2 / 3 / 4 / 5 / 8'de kilitlenir.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari, toplaBilinen, tutarBirlestir } from '../para';
import { tekrarEdenAlicilar } from '../pano/finansKpi';
import {
  ciroSirali,
  leadCariKoduHaritasi,
  musteriOzeti,
} from './musteri';

/** Test fikstürü — kanonik `Order`, faturadan türetilen sipariş ve sentetik Mikro kaydının ORTAK yapısı. */
type TestSiparis = {
  leadId?: unknown;
  mikroCariKod?: unknown;
  customerName?: unknown;
  totalPrice?: unknown;
  /** Testte tarih ÇÖZÜLMEZ (modül tarih çözmez): çağıranın `zamanMs(o.createdAt)` çıktısının yerine geçer. */
  ms?: number | null;
};

const tutarSec = (o: TestSiparis) => o.totalPrice;
const tarihSec = (o: TestSiparis) => o.ms;
const sec = { tutarSec, tarihSec };

const OCAK = Date.UTC(2026, 0, 10);   // 2026-01-10
const SUBAT = Date.UTC(2026, 1, 1);   // 2026-02-01
const MART = Date.UTC(2026, 2, 14);   // 2026-03-14

/**
 * Kimlik zinciri ARTIK MODÜL İÇİ (Faz 3 6a düzeltme turu, 2026-09-22): `raporMusteriKimligi` /
 * `raporMusteriAnahtari` hiçbir ÜRETİM dosyasınca içe aktarılmıyordu ve
 * `components/reports/rapor6a.degismez.test.ts` §2 ("her export en az bir üretim dosyasınca
 * içe aktarılıyor") bu yüzden KIRMIZI teslim edilmişti — "yazıldı ama bağlanmadı" arıza
 * sınıfının bir tekrarı. Zincir SİLİNMEDİ, yalnız dışa açık yüzeyden indi; kapsamı burada
 * `musteriOzeti`nin TEK satırı üzerinden aynen ölçülür (satıra `anahtar`/`tur`/`kimlik`
 * alanları yayılır) ve ÜRETİM davranışı değişmez.
 */
const kimlikOku = (o: TestSiparis, leadCariKodu?: ReadonlyMap<string, string>) => {
  const ozet = musteriOzeti([o], { ...sec, leadCariKodu });
  if (ozet.musteriler.length === 0) return null;
  const { anahtar, tur, kimlik } = ozet.musteriler[0];
  return { anahtar, tur, kimlik };
};
const anahtarOku = (o: TestSiparis) => kimlikOku(o)?.anahtar ?? null;

describe('müşteri kimliği — anahtar zinciri (kimlik ÖNCELİKLİ)', () => {
  it('1. sipariş kendi cari kodunu taşıyorsa `cari:` (lead bağından ÖNCE)', () => {
    expect(kimlikOku({ mikroCariKod: ' 120-SIRIN ', leadId: 'lead-sirin', customerName: 'Şirin İnşaat' }))
      .toEqual({ anahtar: 'cari:120-SIRIN', tur: 'cari', kimlik: '120-SIRIN' });
  });

  it('2. bağ haritası YOKSA lead kaydı `kayit:` olur (uydurma cari kodu üretilmez)', () => {
    expect(kimlikOku({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat' }))
      .toEqual({ anahtar: 'kayit:lead-sirin', tur: 'kayit', kimlik: 'lead-sirin' });
  });

  it('2. bağ haritası VARSA lead → `cari:` (Cetpa kaydı + Mikro carisi TEK müşteri — K4)', () => {
    const harita = new Map([['lead-sirin', '120-SIRIN']]);
    expect(kimlikOku({ leadId: 'lead-sirin' }, harita))
      .toEqual({ anahtar: 'cari:120-SIRIN', tur: 'cari', kimlik: '120-SIRIN' });
  });

  it('3. kimliksiz + adlı → `ad:` YEDEĞİ (yalnız trim; harf katlanmaz)', () => {
    expect(kimlikOku({ customerName: '  Demir Ticaret  ' }))
      .toEqual({ anahtar: 'ad:Demir Ticaret', tur: 'ad', kimlik: 'Demir Ticaret' });
  });

  it("4. '—' ad DEĞİLDİR; sayı / nesne / boolean kimlik de ad da DEĞİLDİR (String(x) yok)", () => {
    expect(kimlikOku({ customerName: '—' })).toBeNull();
    expect(kimlikOku({ customerName: '   ' })).toBeNull();
    expect(kimlikOku({ customerName: 42 })).toBeNull();
    expect(kimlikOku({ customerName: { ad: 'Şirin' } })).toBeNull();
    expect(kimlikOku({ leadId: 7, mikroCariKod: true })).toBeNull();
    expect(kimlikOku({})).toBeNull();
  });

  it('9. önek ZORUNLU: aynı ham değer üç ayrı müşteridir', () => {
    expect(anahtarOku({ mikroCariKod: '120' })).toBe('cari:120');
    expect(anahtarOku({ leadId: '120' })).toBe('kayit:120');
    expect(anahtarOku({ customerName: '120' })).toBe('ad:120');
    expect(anahtarOku({})).toBeNull();
  });
});

describe('musteriOzeti — gruplama, ciro, tarih', () => {
  it('1. PARİTE (tek kimlik): üç sipariş tek satır, ciro eski ad-anahtarlı toplamla BİREBİR', () => {
    const liste: TestSiparis[] = [
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 18500, ms: OCAK },
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 7250, ms: SUBAT },
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 1250, ms: MART },
    ];
    const ozet = musteriOzeti(liste, sec);
    expect(ozet.musteriler).toHaveLength(1);
    const m = ozet.musteriler[0];
    expect(m.anahtar).toBe('kayit:lead-sirin');
    expect(m.ad).toBe('Şirin İnşaat');
    expect(m.adet).toBe(3);
    expect(m.ciro).toEqual({ toplam: 27000, bilinen: 3, bilinmeyen: 0 });
    // Eski `acc[o.customerName || '—'].total += Number(o.totalPrice)` ile AYNI sayı:
    expect(ekranTutari(m.ciro)).toBe(27000);
    expect(ozet.kimliksiz).toBe(0);
    expect(ozet.toplam).toBe(3);
    expect(ozet.adlaGruplanan).toBe(0);
    expect(m.ilkMs).toBe(OCAK);
    expect(m.sonMs).toBe(MART);
    expect(m.ilk).toBe(liste[0]);
    expect(m.son).toBe(liste[2]);
  });

  it('2. AYNI AD, FARKLI KİMLİK = İKİ müşteri (mutasyon: ad öncelikli anahtar → tek satır 17.000)', () => {
    const liste: TestSiparis[] = [
      { leadId: 'lead-a', customerName: 'Yılmaz Yapı', totalPrice: 12000, ms: OCAK },
      { leadId: 'lead-b', customerName: 'Yılmaz Yapı', totalPrice: 5000, ms: SUBAT },
    ];
    const ozet = musteriOzeti(liste, sec);
    expect(ozet.musteriler.map(m => m.anahtar)).toEqual(['kayit:lead-a', 'kayit:lead-b']);
    expect(ozet.musteriler.map(m => ekranTutari(m.ciro))).toEqual([12000, 5000]);
  });

  it('3. AYNI KİMLİK, FARKLI AD YAZIMI = TEK müşteri + EN SON tarihli ad', () => {
    const liste: TestSiparis[] = [
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 1000, ms: MART },
      { leadId: 'lead-sirin', customerName: 'SIRIN INSAAT', totalPrice: 2000, ms: OCAK },
    ];
    const ozet = musteriOzeti(liste, sec);
    expect(ozet.musteriler).toHaveLength(1);
    // Mutasyon: "girdideki son ad" → 'SIRIN INSAAT'; ad anahtarı → 2 satır.
    expect(ozet.musteriler[0].ad).toBe('Şirin İnşaat Ltd. Şti.');
    expect(ozet.musteriler[0].adet).toBe(2);
  });

  it('4. kimliksiz + adlı TEK satırda toplanır; aynı adlı KAYITLI müşteri AYRI satır kalır', () => {
    const liste: TestSiparis[] = [
      { customerName: ' Demir Ticaret ', leadId: null, totalPrice: 1000, ms: OCAK },
      { customerName: 'Demir Ticaret', leadId: null, totalPrice: 2000, ms: SUBAT },
      { customerName: 'Demir Ticaret', leadId: 'lead-demir', totalPrice: 4000, ms: MART },
    ];
    const ozet = musteriOzeti(liste, sec);
    expect(ozet.musteriler.map(m => m.anahtar)).toEqual(['ad:Demir Ticaret', 'kayit:lead-demir']);
    expect(ozet.musteriler[0].tur).toBe('ad');
    expect(ozet.musteriler[0].adet).toBe(2);
    expect(ozet.musteriler[0].ad).toBe('Demir Ticaret');
    expect(ozet.adlaGruplanan).toBe(2);
    expect(ozet.kimliksiz).toBe(0);
  });

  it("5. kimlik de ad da yoksa SATIR OLMAZ, not olur ('—' müşterisi doğmaz)", () => {
    const liste: TestSiparis[] = [
      { customerName: undefined, leadId: null, totalPrice: 100, ms: OCAK },
      { customerName: '', leadId: '', totalPrice: 200, ms: SUBAT },
      { customerName: '   ', totalPrice: 300, ms: MART },
      { customerName: '—', leadId: null, mikroCariKod: '', totalPrice: 400, ms: OCAK },
      { customerName: 42, totalPrice: 500, ms: SUBAT },
    ];
    const ozet = musteriOzeti(liste, sec);
    // Mutasyon: `o.customerName || '—'` → '—' adlı TEK sahte müşteri doğar.
    expect(ozet.musteriler).toHaveLength(0);
    expect(ozet.kimliksiz).toBe(5);
    expect(ozet.kimliksizCiro).toEqual(toplaBilinen(liste, tutarSec));
    expect(ozet.musteriler.some(m => m.ad === '—' || m.kimlik === '—')).toBe(false);
    expect(ozet.toplam).toBe(5);
  });

  it('6. tutarı bilinmeyen sipariş 0 SAYILMAZ: sayılır, müşteri sonda dizilir', () => {
    const liste: TestSiparis[] = [
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 18500, ms: OCAK },
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: undefined, ms: SUBAT },
      { leadId: 'lead-yilmaz', customerName: 'Yılmaz Yapı', totalPrice: null, ms: OCAK },
      { leadId: 'lead-demir', customerName: 'Demir Ticaret', totalPrice: 900, ms: MART },
      { customerName: undefined, totalPrice: 'abc', ms: OCAK },
    ];
    const ozet = musteriOzeti(liste, sec);
    const sirin = ozet.musteriler[0];
    expect(sirin.adet).toBe(2);
    // Mutasyon: `Number(x) || 0` → { toplam: 18500, bilinen: 2, bilinmeyen: 0 }
    expect(sirin.ciro).toEqual({ toplam: 18500, bilinen: 1, bilinmeyen: 1 });
    const yilmaz = ozet.musteriler[1];
    expect(Number.isNaN(ekranTutari(yilmaz.ciro))).toBe(true);
    // Mutasyon: tutarı bilinmeyen müşteri ₺0 ile ORTAYA dizilirdi.
    expect(ciroSirali(ozet.musteriler).map(m => m.anahtar))
      .toEqual(['kayit:lead-sirin', 'kayit:lead-demir', 'kayit:lead-yilmaz']);
    expect(ozet.kimliksizCiro.bilinmeyen).toBe(1);
  });

  it('7. tarihi çözülemeyen sipariş ciroya GİRER, ilk/son tarihe girmez; kimliksizle ÇİFT SAYILMAZ', () => {
    const liste: TestSiparis[] = [
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 1000, ms: SUBAT },
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 2000, ms: null },
      { customerName: undefined, totalPrice: 500, ms: null },
    ];
    const ozet = musteriOzeti(liste, sec);
    const m = ozet.musteriler[0];
    expect(m.adet).toBe(2);
    expect(m.ciro).toEqual({ toplam: 3000, bilinen: 2, bilinmeyen: 0 });
    expect(m.ilkMs).toBe(SUBAT);
    expect(m.sonMs).toBe(SUBAT);
    expect(m.tarihsiz).toBe(1);
    // Kimliksiz + tarihsiz YALNIZ `kimliksiz`de sayılır (mutasyon: sayacı anahtar kontrolünden ÖNCE artırmak).
    expect(ozet.tarihsiz).toBe(1);
    expect(ozet.kimliksiz).toBe(1);
  });

  it('7. NaN / undefined / Infinity da TARİHSİZ; hiç tarihli yoksa ilk/son dördü de null (1970 DEĞİL)', () => {
    const liste: TestSiparis[] = [
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 1000, ms: NaN },
      { leadId: 'lead-sirin', customerName: undefined, totalPrice: 2000 },
      { leadId: 'lead-sirin', customerName: 'ŞİRİN İNŞAAT', totalPrice: 3000, ms: Number.POSITIVE_INFINITY },
    ];
    const ozet = musteriOzeti(liste, sec);
    const m = ozet.musteriler[0];
    expect(m.tarihsiz).toBe(3);
    // Mutasyon: `ms ?? 0` → ilkMs 0 (= 1970).
    expect(m.ilkMs).toBeNull();
    expect(m.sonMs).toBeNull();
    expect(m.ilk).toBeNull();
    expect(m.son).toBeNull();
    // Tarihli aday yok → girdi sırasındaki SON dolu ad.
    expect(m.ad).toBe('ŞİRİN İNŞAAT');
  });

  it('8. Mikro sentetik + bağ: harita YOK → 2 satır, harita VAR → TEK satır, boş kod → bağ YOK', () => {
    const cetpa: TestSiparis = { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 18500, ms: OCAK };
    const mikro: TestSiparis = { mikroCariKod: '120-SIRIN', customerName: 'ŞİRİN İNŞAAT TAAH. A.Ş.', totalPrice: 42000, ms: MART };
    const liste = [cetpa, mikro];

    const a = musteriOzeti(liste, sec);
    expect(a.musteriler.map(m => m.anahtar)).toEqual(['kayit:lead-sirin', 'cari:120-SIRIN']);

    const b = musteriOzeti(liste, { ...sec, leadCariKodu: new Map([['lead-sirin', '120-SIRIN']]) });
    expect(b.musteriler).toHaveLength(1);
    expect(b.musteriler[0].anahtar).toBe('cari:120-SIRIN');
    expect(b.musteriler[0].adet).toBe(2);
    expect(ekranTutari(b.musteriler[0].ciro)).toBe(60500);
    expect(b.musteriler[0].ad).toBe('ŞİRİN İNŞAAT TAAH. A.Ş.');

    const c = musteriOzeti(liste, { ...sec, leadCariKodu: new Map([['lead-sirin', '  ']]) });
    expect(c.musteriler.map(m => m.anahtar)).toEqual(['kayit:lead-sirin', 'cari:120-SIRIN']);
  });

  it('9. önek çakışması: leadId `120` · mikroCariKod `120` · adı `120` = ÜÇ satır', () => {
    const liste: TestSiparis[] = [
      { leadId: '120', totalPrice: 100, ms: OCAK },
      { mikroCariKod: '120', totalPrice: 200, ms: OCAK },
      { customerName: '120', totalPrice: 300, ms: OCAK },
    ];
    // Mutasyon: öneksiz anahtar → 1 satır (600).
    expect(musteriOzeti(liste, sec).musteriler.map(m => m.anahtar))
      .toEqual(['kayit:120', 'cari:120', 'ad:120']);
  });

  it('10. AD = KOD yedeği ad SAYILMAZ: en yeni fatura kodla adlandırılmışsa gerçek unvan korunur', () => {
    const liste: TestSiparis[] = [
      { mikroCariKod: '120-SIRIN', customerName: 'Şirin İnşaat', totalPrice: 1000, ms: OCAK },
      { mikroCariKod: '120-SIRIN', customerName: '120-SIRIN', totalPrice: 2000, ms: MART },
    ];
    expect(musteriOzeti(liste, sec).musteriler[0].ad).toBe('Şirin İnşaat');

    const hepsiKod: TestSiparis[] = [
      { mikroCariKod: '120-SIRIN', customerName: '120-SIRIN', totalPrice: 1000, ms: OCAK },
    ];
    const tekSatir = musteriOzeti(hepsiKod, sec).musteriler[0];
    expect(tekSatir.ad).toBeNull();
    expect(tekSatir.kimlik).toBe('120-SIRIN');

    // `tur === 'ad'` satırında ad = kimlik KORUNUR (dışlama uygulanmaz).
    const adSatiri = musteriOzeti([{ customerName: 'Demir Ticaret', totalPrice: 5, ms: OCAK }], sec).musteriler[0];
    expect(adSatiri.ad).toBe('Demir Ticaret');
  });

  it("11. siparişin KENDİ cari kodu lead bağından ÖNCE gelir", () => {
    const liste: TestSiparis[] = [{ leadId: 'lead-sirin', mikroCariKod: '120-YENI', totalPrice: 100, ms: OCAK }];
    const ozet = musteriOzeti(liste, { ...sec, leadCariKodu: new Map([['lead-sirin', '120-SIRIN']]) });
    expect(ozet.musteriler[0].anahtar).toBe('cari:120-YENI');
  });

  it('12. DEĞİŞMEZLER: adet + kimliksiz = toplam · Σ tarihsiz · ciro birleşimi · adlaGruplanan', () => {
    const liste: TestSiparis[] = [
      { leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 18500, ms: OCAK },
      { mikroCariKod: '120-SIRIN', customerName: 'ŞİRİN İNŞAAT', totalPrice: 42000, ms: MART },
      { customerName: 'Demir Ticaret', totalPrice: undefined, ms: null },
      { customerName: 'Demir Ticaret', totalPrice: 1250, ms: SUBAT },
      { customerName: '—', totalPrice: 400, ms: null },
      { leadId: 'lead-yilmaz', customerName: 'Yılmaz Yapı', totalPrice: 'abc', ms: NaN },
    ];
    const ozet = musteriOzeti(liste, sec);
    const toplamAdet = ozet.musteriler.reduce((a, m) => a + m.adet, 0);
    expect(toplamAdet + ozet.kimliksiz).toBe(ozet.toplam);
    expect(ozet.musteriler.reduce((a, m) => a + m.tarihsiz, 0)).toBe(ozet.tarihsiz);
    expect(tutarBirlestir(...ozet.musteriler.map(m => m.ciro), ozet.kimliksizCiro))
      .toEqual(toplaBilinen(liste, tutarSec));
    expect(ozet.adlaGruplanan)
      .toBe(ozet.musteriler.filter(m => m.tur === 'ad').reduce((a, m) => a + m.adet, 0));
  });

  it('12. boş liste: satır yok, sayaçlar 0, kimliksizCiro sıfır', () => {
    const ozet = musteriOzeti([] as TestSiparis[], sec);
    expect(ozet.musteriler).toEqual([]);
    expect(ozet.kimliksiz).toBe(0);
    expect(ozet.adlaGruplanan).toBe(0);
    expect(ozet.tarihsiz).toBe(0);
    expect(ozet.toplam).toBe(0);
    expect(ozet.kimliksizCiro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });

  it('12. SAFLIK: donmuş girdi/harita hata atmaz, sıra ve içerik değişmez', () => {
    const a = Object.freeze({ leadId: 'lead-sirin', customerName: 'Şirin İnşaat', totalPrice: 100, ms: MART });
    const b = Object.freeze({ leadId: 'lead-yilmaz', customerName: 'Yılmaz Yapı', totalPrice: 900, ms: OCAK });
    const liste = Object.freeze([a, b]) as readonly TestSiparis[];
    const harita: ReadonlyMap<string, string> = Object.freeze(new Map([['lead-sirin', '120-SIRIN']]));
    const ozet = musteriOzeti(liste, { ...sec, leadCariKodu: harita });
    expect(ozet.musteriler).toHaveLength(2);
    expect(liste).toEqual([a, b]);

    const sirali = ciroSirali(ozet.musteriler);
    expect(sirali.map(m => m.anahtar)).toEqual(['kayit:lead-yilmaz', 'cari:120-SIRIN']);
    // Girdinin sırası DEĞİŞMEDİ (kopya üzerinde sıralanır).
    expect(ozet.musteriler.map(m => m.anahtar)).toEqual(['cari:120-SIRIN', 'kayit:lead-yilmaz']);
  });

  it('12. ciroSirali beraberlikte İLK GÖRÜLME sırasını korur', () => {
    const liste: TestSiparis[] = [
      { leadId: 'lead-a', customerName: 'Yılmaz Yapı', totalPrice: 1000, ms: OCAK },
      { leadId: 'lead-b', customerName: 'Demir Ticaret', totalPrice: 1000, ms: OCAK },
    ];
    expect(ciroSirali(musteriOzeti(liste, sec).musteriler).map(m => m.anahtar))
      .toEqual(['kayit:lead-a', 'kayit:lead-b']);
  });

  it('13. PANO PARİTESİ (yalnız kimlik alanı TAŞIMAYAN, "—" içermeyen fikstürde)', () => {
    const liste: TestSiparis[] = [
      { customerName: 'Şirin İnşaat', totalPrice: 1000, ms: OCAK },
      { customerName: 'Şirin İnşaat', totalPrice: 2000, ms: SUBAT },
      { customerName: 'Yılmaz Yapı', totalPrice: 3000, ms: MART },
      { customerName: undefined, totalPrice: 400, ms: OCAK },
      { customerName: '   ', totalPrice: 500, ms: OCAK },
    ];
    const ozet = musteriOzeti(liste, sec);
    const pano = tekrarEdenAlicilar(liste);
    expect(ozet.musteriler).toHaveLength(pano.benzersiz);
    expect(ozet.kimliksiz).toBe(pano.isimsiz);
  });
});

describe('leadCariKoduHaritasi — lead.id → lead.mikroCariKod', () => {
  it('14. yalnız İKİ alanı da dolu METİN olan lead bağ kurar; kod trim edilir', () => {
    const harita = leadCariKoduHaritasi([
      { id: 'lead-sirin', mikroCariKod: ' 120-SIRIN ' },
      { id: 'lead-x' },
      { id: '', mikroCariKod: '1' },
      { id: 'lead-y', mikroCariKod: '  ' },
      { id: 7, mikroCariKod: '9' },
    ]);
    expect(harita.size).toBe(1);
    expect(harita.get('lead-sirin')).toBe('120-SIRIN');
  });

  it('14. aynı koda bağlı İKİ lead (mükerrer kayıt) aynı `cari:` kovasına düşer', () => {
    const harita = leadCariKoduHaritasi([
      { id: 'lead-1', mikroCariKod: '120-SIRIN' },
      { id: 'lead-2', mikroCariKod: '120-SIRIN' },
    ]);
    const liste: TestSiparis[] = [
      { leadId: 'lead-1', customerName: 'Şirin İnşaat', totalPrice: 1000, ms: OCAK },
      { leadId: 'lead-2', customerName: 'Şirin İnşaat', totalPrice: 2000, ms: SUBAT },
    ];
    const ozet = musteriOzeti(liste, { ...sec, leadCariKodu: harita });
    expect(ozet.musteriler).toHaveLength(1);
    expect(ozet.musteriler[0].adet).toBe(2);
  });

  it('14. boş liste → boş harita (bağ kurulmaz, uydurma yok)', () => {
    expect(leadCariKoduHaritasi([]).size).toBe(0);
  });
});
