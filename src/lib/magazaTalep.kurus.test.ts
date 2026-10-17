/**
 * magazaTalep.kurus.test.ts — birim fiyat EN ÇOK İKİ ONDALIK (kuruş): kullanıcı kararı 2026-10-17 («kuruştan ince birim fiyat
 * kabul edilsin mi? — hayır»), şartname «kayıt kapanışı ve kuruş» B1–B3, test T4 (saf vektörler + şema).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   - TEK saf işlev (`magazaKurusluMu`) kayan nokta kalıntısına dayanıklıdır: 95,1 · 1,15 · 0,29 · 0,1 + 0,2 · 9.999.999,99 KABUL;
 *     83,3333 · 0,001 · 1,005 · 1,005001 · NaN / sonsuz RED; 1 trilyon TL (1e14 kuruş) ve üstü RED (İ1-b);
 *   - kabul edilen fiyatın kuruşu, toplam işlevinin (`magazaTeyitToplamlari`) yuvarlayarak bulduğu kuruşla AYNIDIR;
 *   - ERP'nin iki gövdesi (`ErpIcerikGovdesi` teyit kalemi, `ErpElleTalepGovdesi` kalemi) kuruştan ince fiyatı şemanın kendi
 *     hata biçimiyle reddeder (ileti `MAGAZA_BIRIM_FIYAT_KURUS_HATASI`, yol `birimFiyat`); `null` («fiyat sorulacak») DEĞİŞMEZ;
 *   - kimliksiz talep şeması (dilim 1, müşterinin beyanı) 83,3333'ü AYNEN kabul eder (B3 çiti);
 *   - form ayrıştırıcısı (`magazaFiyatCoz`) aynı hükmü verir — önizleme ve gövde oradan okur.
 * Uç düzeyi: `server/routes/magazaPanelUclar.test.ts` (içerik / elle talep 400 + kayıt değişmez) ve `magazaRoutes.test.ts`
 * (kimliksiz uç 83,3333 → 201, AYNEN yazılır); form çizimi: `components/siparis/MagazaTalepDuzenle.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { MAGAZA_BIRIM_FIYAT_KURUS_HATASI, magazaKurusluMu, magazaTeyitToplamlari } from './magazaTalep';
import { magazaFiyatCoz } from './magazaTalepFormu';
import { ErpElleTalepGovdesi, ErpIcerikGovdesi, MagazaSiparisTalebiSchema } from '../server/schemas';

/** Kayan nokta kalıntılı ama İKİ ONDALIKLI değerler (çarpım ya da toplam kalıntısı). */
const KABUL: Array<[string, number]> = [
  ['95,1', 95.1],
  ['1,15 (× 100 = 114,99999999999999)', 1.15],
  ['0,29 (× 100 = 28,999999999999996)', 0.29],
  ['0,07 (× 100 = 7,000000000000001)', 0.07],
  ['0,1 + 0,2 (= 0,30000000000000004)', 0.1 + 0.2],
  ['1 + ε (= 1,0000000000000002)', 1 + Number.EPSILON],
  ['9.999.999,99', 9999999.99],
  ['95,5', 95.5],
  ['204,99', 204.99],
  ['0', 0],
  ['0,01', 0.01],
  ['999.999.999.999,99 (1e14 kuruşun — 1 trilyon TL — hemen altı)', 999999999999.99],
];
/** Kuruştan ince değerler. */
const RED: Array<[string, number]> = [
  ['83,3333', 83.3333],
  ['0,001', 0.001],
  ['1,005 (yarım kuruş; × 100 = 100,49999999999999)', 1.005],
  ['1,005001', 1.005001],
  ['0,145', 0.145],
  ['0,015', 0.015],
  ['NaN', NaN],
  ['+sonsuz', Infinity],
  ['−sonsuz', -Infinity],
  ['5e-324 (en küçük pozitif)', 5e-324],
  ['10 trilyon TL (1e15 kuruş — ondalık ölçülemez)', 1e13],
  // İ1-b (inceleme 1, 2026-10-17): sınır 1e14 kuruş (1 trilyon TL). Eskiden 1e15'ti: 1e14–1e15 aralığında 15 anlamlı hanenin hiçbiri
  // kuruşun altında kalmıyor, kuruştan ince fiyat «kuruşlu» görünüyordu (aşağıdaki 1.000.000.000.000,555 KABUL ediliyordu).
  ['9.999.999.999.999,99 (eskiden KABUL; 1e14 kuruşun üstü)', 9999999999999.99],
  ['1.000.000.000.000,555 (kuruştan ince; eskiden temizlikle 100.000.000.000.056 kuruş → KABUL)', 1000000000000.555],
  ['1 trilyon TL (1e14 kuruş — sınırın kendisi)', 1e12],
  ['999.999.999.999,995 (sınırın altında yarım kuruş — hâlâ görülür)', 999999999999.995],
];

describe('magazaKurusluMu — en çok iki ondalık, kayan nokta kalıntısına dayanıklı (B1)', () => {
  it('kalıntıyı tuzağın kendisiyle göster: saf `Number.isInteger(n × 100)` 1,15 / 0,29 / 0,1 + 0,2 gibi GEÇERLİ fiyatları reddederdi', () => {
    expect(Number.isInteger(1.15 * 100)).toBe(false);
    expect(Number.isInteger(0.29 * 100)).toBe(false);
    expect(Number.isInteger((0.1 + 0.2) * 100)).toBe(false);
    // Ve saf `Math.round` denetimi 1,005'i (yarım kuruş) 1,00'e yuvarlar — üç ondalık olduğu gizlenirdi.
    expect(Math.round(1.005 * 100)).toBe(100);
  });

  it.each(KABUL)('KABUL: %s', (_ad, n) => {
    expect(magazaKurusluMu(n)).toBe(true);
  });

  it.each(RED)('RED: %s', (_ad, n) => {
    expect(magazaKurusluMu(n)).toBe(false);
  });

  it('kabul edilen fiyatın kuruşu toplam işlevinin yuvarladığı kuruşla AYNI (yuvarlama hiçbir şey değiştirmez): 1 × fiyat, %0', () => {
    for (const [ad, n] of KABUL) {
      const t = magazaTeyitToplamlari([{ adet: 1, birimFiyat: n, kdvOrani: 0 }]);
      expect(t.araToplam, ad).not.toBeNull();
      // İki ondalığa yuvarlanmış metin değeri, toplamın kuruşuyla birebir (kalıntı dışında fark yok).
      expect(t.araToplam, ad).toBe(Number(n.toFixed(2)));
    }
  });

  it('hata metni tek sabit: «Birim fiyat en çok iki ondalık olabilir (kuruş).»', () => {
    expect(MAGAZA_BIRIM_FIYAT_KURUS_HATASI).toBe('Birim fiyat en çok iki ondalık olabilir (kuruş).');
  });
});

describe('form ayrıştırıcısı aynı hükmü verir (`magazaFiyatCoz`, B2)', () => {
  it('virgüllü yazım: iki ondalık → sayı (95,50 → 95,5; sondaki sıfır ondalık sayılmaz); üç ondalık → `kurustan-ince`; boş → `bos`', () => {
    expect(magazaFiyatCoz('95,50')).toEqual({ tur: 'sayi', deger: 95.5 });
    expect(magazaFiyatCoz('95,500')).toEqual({ tur: 'sayi', deger: 95.5 });
    expect(magazaFiyatCoz('9999999,99')).toEqual({ tur: 'sayi', deger: 9999999.99 });
    expect(magazaFiyatCoz('95,1')).toEqual({ tur: 'sayi', deger: 95.1 });
    expect(magazaFiyatCoz('1,15')).toEqual({ tur: 'sayi', deger: 1.15 });
    expect(magazaFiyatCoz('')).toEqual({ tur: 'bos' });
    for (const ince of ['83,3333', '0,001', '1,005', '1,005001', '0,015', '12,345']) expect(magazaFiyatCoz(ince), ince).toEqual({ tur: 'kurustan-ince' });
    // Belirsizlik kuralı ÖNCE gelir: nokta + tam üç hane binlik ayraç olabilir → `gecersiz` (kuruş sorusuna gelinmez).
    expect(magazaFiyatCoz('1.005')).toEqual({ tur: 'gecersiz' });
  });

  it('İ1-b — 1 trilyon TL (1e14 kuruş) ve üstü `gecersiz` (kuruş sorusundan ÖNCE); hemen altı iki ondalıkla sayı', () => {
    expect(magazaFiyatCoz('10000000000000')).toEqual({ tur: 'gecersiz' });
    expect(magazaFiyatCoz('1000000000000')).toEqual({ tur: 'gecersiz' });
    expect(magazaFiyatCoz('1000000000000,555')).toEqual({ tur: 'gecersiz' });   // «kuruştan ince» DEĞİL: büyüklük geçersiz
    expect(magazaFiyatCoz('9999999999999,99')).toEqual({ tur: 'gecersiz' });
    expect(magazaFiyatCoz('999999999999,99')).toEqual({ tur: 'sayi', deger: 999999999999.99 });
    expect(magazaFiyatCoz('999999999999,995')).toEqual({ tur: 'kurustan-ince' });
  });

  it('İ1-b — toplam işlevinin 1e15 kuruş sınırı DEĞİŞMEDİ (savunma): 9.999.999.999.999,99 toplamda hâlâ TAM', () => {
    expect(magazaTeyitToplamlari([{ adet: 1, birimFiyat: 9999999999999.99, kdvOrani: 0 }]).araToplam).toBe(9999999999999.99);
    expect(magazaTeyitToplamlari([{ adet: 1, birimFiyat: 1e13, kdvOrani: 0 }]).araToplam).toBeNull();
  });

  it('her vektörde ayrıştırıcı ile saf işlev AYNI hükmü verir (iki ayrı kural yok)', () => {
    for (const metin of ['95,1', '1,15', '0,29', '0,07', '204,99', '0', '0,01', '83,3333', '0,001', '1,005', '1,005001', '0,145', '9999999,99']) {
      const n = Number(metin.replace(',', '.'));
      const c = magazaFiyatCoz(metin);
      expect(c.tur, metin).toBe(magazaKurusluMu(n) ? 'sayi' : 'kurustan-ince');
    }
  });
});

describe('sunucu şemaları (B1, B3)', () => {
  const musteri = { ad: 'Ümit Çağlar', telefon: '0533 444 55 66' };
  const icerik = (birimFiyat: unknown) => ({ icerikSurum: 0, teyit: { kalemler: [{ ad: 'Saten alçı', adet: 12, birimFiyat }] } });
  const elle = (birimFiyat: unknown) => ({ musteri, kalemler: [{ ad: 'Saten alçı', adet: 12, birimFiyat }] });
  const dilim1 = (birimFiyat: unknown) => ({ no: 'T261017-AB12', musteri, kalemler: [{ ad: 'Saten alçı', adet: 12, birimFiyat }] });

  it('içerik (teyit kalemi) ve elle talep: kuruştan ince → ret; şemanın KENDİ hata biçimi — yol `birimFiyat`, ileti sabit metin', () => {
    for (const [ad, n] of RED.filter(([, v]) => Number.isFinite(v))) {
      for (const [sema, govde, yol] of [
        [ErpIcerikGovdesi, icerik(n), ['teyit', 'kalemler', 0, 'birimFiyat']],
        [ErpElleTalepGovdesi, elle(n), ['kalemler', 0, 'birimFiyat']],
      ] as const) {
        const s = sema.safeParse(govde);
        expect(s.success, ad).toBe(false);
        if (s.success) continue;
        expect(s.error.issues.map(i => [i.path, i.message]), ad).toEqual([[yol, MAGAZA_BIRIM_FIYAT_KURUS_HATASI]]);
      }
    }
  });

  it('içerik ve elle talep: iki ondalıklı (kalıntılı dâhil) fiyat ve `null` («fiyat sorulacak») GEÇER; elle talepte `birimFiyat` yine isteğe bağlı', () => {
    for (const [ad, n] of KABUL) {
      expect(ErpIcerikGovdesi.safeParse(icerik(n)).success, ad).toBe(true);
      expect(ErpElleTalepGovdesi.safeParse(elle(n)).success, ad).toBe(true);
    }
    expect(ErpIcerikGovdesi.safeParse(icerik(null)).success).toBe(true);
    expect(ErpElleTalepGovdesi.safeParse(elle(null)).success).toBe(true);
    expect(ErpElleTalepGovdesi.safeParse({ musteri, kalemler: [{ ad: 'Mala', adet: 1 }] }).success).toBe(true);
    // Teyit kaleminde anahtar ZORUNLU kalır (sayı ya da açıkça null) — kuruş kuralı bunu gevşetmedi.
    expect(ErpIcerikGovdesi.safeParse({ icerikSurum: 0, teyit: { kalemler: [{ ad: 'Mala', adet: 1 }] } }).success).toBe(false);
  });

  it('negatif fiyat eskisi gibi ret (kuruşlu olsa da); sonsuz / NaN şemada zaten ret', () => {
    for (const n of [-1, -95.5, Infinity, NaN]) {
      expect(ErpIcerikGovdesi.safeParse(icerik(n)).success, String(n)).toBe(false);
      expect(ErpElleTalepGovdesi.safeParse(elle(n)).success, String(n)).toBe(false);
    }
  });

  it('elle talep kaleminin GERİ KALANI kimliksiz talebinkiyle aynı: `adet: 0` / boş kalem listesi ret; tanınmayan kalem alanı atılır', () => {
    expect(ErpElleTalepGovdesi.safeParse({ musteri, kalemler: [{ ad: 'x', adet: 0, birimFiyat: 1 }] }).success).toBe(false);
    expect(ErpElleTalepGovdesi.safeParse({ musteri, kalemler: [] }).success).toBe(false);
    const s = ErpElleTalepGovdesi.safeParse({ musteri, kalemler: [{ ad: 'x', adet: 1, birimFiyat: 1, fazla: 'y' }] });
    expect(s.success && s.data.kalemler[0]).toEqual({ ad: 'x', adet: 1, birimFiyat: 1 });
    // Dış nesne `.strict()` kalır.
    expect(ErpElleTalepGovdesi.safeParse({ ...elle(1), no: 'T261017-AB12' }).success).toBe(false);
  });

  it('B3 çiti: kimliksiz talep şeması (müşterinin beyanı) 83,3333 ve öbür kuruştan ince değerleri AYNEN kabul eder', () => {
    for (const [ad, n] of RED.filter(([, v]) => Number.isFinite(v))) {
      const s = MagazaSiparisTalebiSchema.safeParse(dilim1(n));
      expect(s.success, ad).toBe(true);
      expect(s.success && s.data.kalemler[0].birimFiyat, ad).toBe(n);
    }
  });
});
