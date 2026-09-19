/**
 * amortisman.test.ts — sabit kıymet amortismanının TEK kuralı (Faz 3 5/n düzeltici turu,
 * 2026-09-19). ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * ## Neden var — düzeltilen sahte kesinlik
 *
 * `src/utils/pano/raporVeriKatmani.ts:196` `birikmisSalinma: 0`ı BİLİNEN sıfır amortisman
 * okuyordu. Oysa `SabitKiymetModule.tsx:37` alanı "manuel override, 0 = hesaplansın" diye
 * tanımlıyor ve form varsayılanı (satır 320) tam olarak 0'dır: yani forma girilen HER
 * demirbaş Bilanço'ya amortismansız, BRÜT alış bedeliyle "Net" diye giriyordu. Aynı demirbaş
 * SabitKiymet listesinde (calcNetDeger, satır 128) amortismanlı net değerle görünüyordu —
 * bir varlık, iki ekran, iki farklı rakam.
 *
 * Hesabın kendisi `SabitKiymetModule.tsx` içinde, sayfaya gömülü ve testsizdi; bu modül onu
 * saf hâle çıkarır. Sayfa da artık buradan okur (KOPYA YOK).
 *
 * ## Sözleşme
 * Amortisman TÜRETİLEN sayıdır: alış bedeli, alış tarihi ya da faydalı ömür bilinmiyorsa
 * HESAPLANMAZ (NaN → ekranda '—'). Eski kod bu durumda 0 döndürüyordu, yani "amortismanı yok"
 * diyordu — "bilinmiyor" değil.
 *
 * ## Parite
 * Girdiler biliniyorken sayı `SabitKiymetModule`in eski `calcBirikmisSalinma` /
 * `calcNetDeger` / `calcYillikAmort` / `calcAylikAmort` fonksiyonlarıyla BİREBİR aynıdır.
 */
import { describe, it, expect } from 'vitest';
import {
  birikmisAmortisman,
  netDeger,
  yillikAmortisman,
  aylikAmortisman,
  type AmortismanGirdisi,
} from './amortisman';

/** Sabit "bugün" — testler takvime göre kaymasın. */
const BUGUN = new Date(2026, 8, 19);   // 2026-09-19

/** Forklift: Şirin İnşaat'ın 2022-09 alımı, ₺1.200.000, 5 yıl doğrusal, override YOK (form varsayılanı 0). */
const forklift: AmortismanGirdisi = {
  alisBedeli: 1_200_000,
  alisTarihi: '2022-09-19',
  faydaliOmur: 5,
  amortYontemi: 'Doğrusal',
  birikmisSalinma: 0,
};

describe('birikmisAmortisman — doğrusal', () => {
  it('4 yıl geçmiş ₺1.200.000 / 5 yıl → ₺960.000 (0 DEĞİL)', () => {
    expect(birikmisAmortisman(forklift, BUGUN)).toBeCloseTo(960_000, -3);
  });

  it('net değer brüt bedel DEĞİL — Bilanço ile SabitKiymet listesi aynı rakamı verir', () => {
    expect(netDeger(forklift, BUGUN)).toBeCloseTo(240_000, -3);
    // Mutasyon ayırt edici: `birikmisSalinma: 0`ı bilinen sıfır sayan eski okuma 1.200.000 verirdi.
    expect(netDeger(forklift, BUGUN)).not.toBeCloseTo(1_200_000, -3);
  });

  it('faydalı ömrü aşan süre ömürle sınırlanır (ömür sonrası net 0)', () => {
    expect(birikmisAmortisman({ ...forklift, alisTarihi: '2015-01-01' }, BUGUN)).toBeCloseTo(1_200_000, -3);
    expect(netDeger({ ...forklift, alisTarihi: '2015-01-01' }, BUGUN)).toBe(0);
  });

  it('bugün alınan varlıkta birikmiş amortisman BİLİNEN 0’dır', () => {
    expect(birikmisAmortisman({ ...forklift, alisTarihi: '2026-09-19' }, BUGUN)).toBe(0);
    expect(netDeger({ ...forklift, alisTarihi: '2026-09-19' }, BUGUN)).toBe(1_200_000);
  });

  it('gelecek tarihli alışta da 0 (negatif amortisman üretilmez)', () => {
    expect(birikmisAmortisman({ ...forklift, alisTarihi: '2027-01-01' }, BUGUN)).toBe(0);
  });
});

describe('birikmisAmortisman — manuel override', () => {
  it('birikmisSalinma > 0 ise HESAPLANMAZ, o değer kullanılır', () => {
    expect(birikmisAmortisman({ ...forklift, birikmisSalinma: 300_000 }, BUGUN)).toBe(300_000);
  });

  it('override alış bedelini aşamaz', () => {
    expect(birikmisAmortisman({ ...forklift, birikmisSalinma: 5_000_000 }, BUGUN)).toBe(1_200_000);
  });

  it('override varsa alış tarihi olmasa bile amortisman BİLİNİR', () => {
    expect(birikmisAmortisman({ alisBedeli: 1_200_000, birikmisSalinma: 300_000 }, BUGUN)).toBe(300_000);
  });
});

describe('birikmisAmortisman — bilinmeyen girdi 0 SAYILMAZ', () => {
  const bilinmeyenVakalari: ReadonlyArray<[string, AmortismanGirdisi]> = [
    ['alış tarihi yok (Mikro importu tarihi çözemedi)', { ...forklift, alisTarihi: undefined }],
    ['alış tarihi boş dize', { ...forklift, alisTarihi: '' }],
    ['alış tarihi çözülemiyor', { ...forklift, alisTarihi: 'bilinmiyor' }],
    ['faydalı ömür yok', { ...forklift, faydaliOmur: undefined }],
    ['faydalı ömür 0 (sıfıra bölme)', { ...forklift, faydaliOmur: 0 }],
    ['faydalı ömür negatif', { ...forklift, faydaliOmur: -3 }],
    ['alış bedeli yok', { ...forklift, alisBedeli: undefined }],
    ['alış bedeli metin', { ...forklift, alisBedeli: 'bilinmiyor' }],
  ];
  for (const [ad, girdi] of bilinmeyenVakalari) {
    it(`${ad} → NaN ('—'), 0 DEĞİL`, () => {
      expect(birikmisAmortisman(girdi, BUGUN)).toBeNaN();
      expect(netDeger(girdi, BUGUN)).toBeNaN();
    });
  }

  it('bedeli bilinmeyen varlık override ile bile net değer ÜRETMEZ', () => {
    expect(netDeger({ alisBedeli: undefined, birikmisSalinma: 300_000 }, BUGUN)).toBeNaN();
  });
});

describe('birikmisAmortisman — azalan bakiyeler (DDB)', () => {
  const ddb: AmortismanGirdisi = {
    alisBedeli: 100_000,
    alisTarihi: '2024-09-19',
    faydaliOmur: 5,
    amortYontemi: 'Azalan Bakiyeler',
    birikmisSalinma: 0,
  };

  it('2 tam yıl: 40.000 + 24.000 = 64.000 (oran 2/5)', () => {
    expect(birikmisAmortisman(ddb, BUGUN)).toBeCloseTo(64_000, -3);
    expect(netDeger(ddb, BUGUN)).toBeCloseTo(36_000, -3);
  });

  it('kesirli yıl kalan bakiyeden orantılı eklenir', () => {
    // 1 tam yıl (40.000) + yarım yıl → 60.000 × 0,4 × 0,5 = 12.000
    const yarim = birikmisAmortisman({ ...ddb, alisTarihi: '2025-03-21' }, BUGUN);
    expect(yarim).toBeGreaterThan(40_000);
    expect(yarim).toBeLessThan(64_000);
  });

  it('birikmiş amortisman alış bedelini ASLA aşmaz', () => {
    expect(birikmisAmortisman({ ...ddb, alisTarihi: '2000-01-01' }, BUGUN)).toBeLessThanOrEqual(100_000);
  });
});

describe('yillikAmortisman / aylikAmortisman', () => {
  it('doğrusal: bedel / ömür', () => {
    expect(yillikAmortisman(forklift, BUGUN)).toBeCloseTo(240_000, -3);
    expect(aylikAmortisman(forklift, BUGUN)).toBeCloseTo(20_000, -3);
  });

  it('tamamen amortismana tabi tutulmuşsa 0 (ömür sonrası sonsuz amortisman yok)', () => {
    expect(yillikAmortisman({ ...forklift, alisTarihi: '2010-01-01' }, BUGUN)).toBe(0);
  });

  it('azalan bakiyeler: kalan değer × oran', () => {
    const ddb: AmortismanGirdisi = {
      alisBedeli: 100_000, alisTarihi: '2024-09-19', faydaliOmur: 5,
      amortYontemi: 'Azalan Bakiyeler', birikmisSalinma: 0,
    };
    // kalan 36.000 × 0,4 = 14.400
    expect(yillikAmortisman(ddb, BUGUN)).toBeCloseTo(14_400, -3);
  });

  it('ömür bilinmiyorsa yıllık amortisman HESAPLANMAZ (eski kod 0 diyordu)', () => {
    expect(yillikAmortisman({ ...forklift, faydaliOmur: undefined }, BUGUN)).toBeNaN();
    expect(aylikAmortisman({ ...forklift, faydaliOmur: undefined }, BUGUN)).toBeNaN();
  });

  it('alış tarihi bilinmiyorsa yıllık amortisman da bilinmez (birikmiş kapısı)', () => {
    expect(yillikAmortisman({ ...forklift, alisTarihi: undefined }, BUGUN)).toBeNaN();
  });
});

describe('amortYontemi dalı — PARİTE (bilinçli olarak DEĞİŞTİRİLMEDİ)', () => {
  // Eski kod `item.amortYontemi === 'Doğrusal' ? doğrusal : DDB` diyordu, yani yöntemi
  // YAZILMAMIŞ kayıt sessizce azalan bakiyelere düşüyordu. Bu da bir varsayımdır ama bu turun
  // kapsamı değil: hem form hem Mikro importu yöntemi HER ZAMAN yazıyor (demirbasEsle:
  // `amortYontemi: eski?.amortYontemi ?? 'Doğrusal'`), yani tetiklenebilir bir yüzeyi yok.
  // Davranışı çevirmek sessiz bir rakam değişikliği olurdu; Açık İşler'e yazıldı.
  it("yöntem yazılmamışsa eski dal korunur: azalan bakiyeler", () => {
    const y = birikmisAmortisman({ ...forklift, amortYontemi: undefined }, BUGUN);
    expect(y).not.toBeCloseTo(960_000, -3);          // doğrusal DEĞİL
    expect(y).toBeGreaterThan(0);
    expect(Number.isFinite(y)).toBe(true);
  });

  it("'Doğrusal' yazılıysa doğrusal", () => {
    expect(birikmisAmortisman({ ...forklift, amortYontemi: 'Doğrusal' }, BUGUN)).toBeCloseTo(960_000, -3);
  });
});
