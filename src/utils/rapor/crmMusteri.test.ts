/**
 * crmMusteri.test.ts — ciro köprüsü / selale (Faz 3 6b, grup "utils-crm-musteri", 2026-09-24).
 * ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * ## Neden var
 * `components/reports/genel/GenelBloklar3.tsx:410-466` "Revenue Attribution Waterfall (MoM)" (HEAD 912d750):
 *   - `:430-431` `new Set(map(o.customerName))` — müşteri AD METNİYLE gruplanıyor; `undefined`/''/'—' TEK
 *     anahtara çöküyor → adsız siparişlerin tamamı "korunan müşteri" sayılıyor.
 *   - `:428-429, 432-434` `reduce((s,o)=>s+o.totalPrice,0)` — korumasız; tek eksik tutar `prevRev`i NaN yapıp
 *     `maxVal`i NaN'a düşürüyor → TÜM çubuklar %0, nedeni yazmıyor.
 *   - `:443` `Math.max(…, 1)` + `:454` `maxVal>0 ? … : 0` — bilinmeyen ile gerçek 0 aynı çizime düşüyor.
 *
 * ## KULLANICI KARARLARI (KARARLAR.md — BAĞLAYICI), kullanıcının cümleleri:
 *   K4 · "Müşteriyi adla mı kimlikle mi gruplayacağız → kimlikle."  (test 2, 3, 4 — mutasyonları KIRMIZI olmalı)
 *   K2 · "İptaller ciroya girsin mi → hayır."  (panelde ZATEN uygulanıyor; süzgeç ÇAĞIRANDA — bu modül `status` okumaz)
 *
 * ## Parite
 * Tam veride (her siparişin tutarı ve müşterisi biliniyor, ad çakışması yok) rakamlar ESKİ formülle BİREBİR —
 * test 1 eski formülü (`newCustRev` / `retainedRev` / `lostRev`) test içinde hesaplayıp eşitliği ölçer.
 * BİLİNÇLİ FARKLAR (K4 + `tamTutar` sözleşmesi) test 2 / 3 / 4 / 5 / 6 / 7'de kilitlenir.
 *
 * Girdi `musteriOzeti(...)` ÇIKTISIDIR — test kendi elle `MusteriOzeti` uydurmaz (sözleşme kayması olmasın).
 */
import { describe, it, expect } from 'vitest';
import { musteriOzeti } from './musteri';
import { ciroKopru } from './crmMusteri';

/** Test fikstürü — kanonik `Order`, faturadan türetilen sipariş ve sentetik Mikro kaydının ORTAK yapısı. */
type TestSiparis = {
  leadId?: unknown;
  mikroCariKod?: unknown;
  customerName?: unknown;
  totalPrice?: unknown;
  /** Testte tarih ÇÖZÜLMEZ (modül tarih görmez): çağıranın `zamanMs(o.createdAt)` çıktısının yerine geçer. */
  ms?: number | null;
};

const tutarSec = (o: TestSiparis) => o.totalPrice;
const tarihSec = (o: TestSiparis) => o.ms;

/** İKİ dönem AYNI seçenek nesnesiyle kurulur (hakem maddesi 1: bağ haritası bir dönemde kopmasın). */
const ozet = (liste: readonly TestSiparis[], leadCariKodu?: ReadonlyMap<string, string>) =>
  musteriOzeti(liste, { tutarSec, tarihSec, leadCariKodu });

const SIRIN = 'Şirin İnşaat';
const HANDEKO = 'Handeko Yapı';
const CIMSA = 'CİMSA Beton';

/**
 * Karışık fikstür (test 9 / 10 / 13 / 14 ortak): 1 yeni, 1 büyüyen, 1 küçülen, 1 kaybedilen, 1 sabit,
 * 1 tutarsız, 2 kimliksiz. Kuruşlu tutarlar bilerek: toplama sırası farkının `net` ile taban farkını
 * kuruş altında ayırabildiği yerde `toBeCloseTo(…, 6)` ölçer.
 */
const KARISIK = {
  onceki: [
    { leadId: 'L2', customerName: SIRIN, totalPrice: 100000.15 },       // büyüyen
    { leadId: 'L3', customerName: HANDEKO, totalPrice: 80000.33 },      // küçülen
    { leadId: 'L4', customerName: CIMSA, totalPrice: 40000.07 },        // kaybedilen
    { leadId: 'L5', customerName: 'Sabit Yapı', totalPrice: 75000 },    // sabit
    { leadId: 'L6', customerName: 'Tutarsız Ltd', totalPrice: 10000 },  // tutarsız (bu ayı okunamıyor)
    { customerName: undefined, totalPrice: 5000 },                      // kimliksiz
  ] as const satisfies readonly TestSiparis[],
  bu: [
    { leadId: 'L1', customerName: 'Yeni Müşteri A.Ş.', totalPrice: 25000.5 }, // yeni
    { leadId: 'L2', customerName: SIRIN, totalPrice: 130000.42 },      // büyüyen (+30000.27)
    { leadId: 'L3', customerName: HANDEKO, totalPrice: 60000.11 },     // küçülen (−20000.22)
    { leadId: 'L5', customerName: 'Sabit Yapı', totalPrice: 75000 },   // sabit
    { leadId: 'L6', customerName: 'Tutarsız Ltd', totalPrice: undefined }, // tutarsız
    { customerName: '', totalPrice: 7000 },                            // kimliksiz
  ] as const satisfies readonly TestSiparis[],
};

describe('ciroKopru — parite', () => {
  it('1 · tam veride ESKİ formülle birebir (GenelBloklar3.tsx:428-435)', () => {
    const prevOrders: TestSiparis[] = [
      { leadId: 'L1', customerName: SIRIN, totalPrice: 100000 },
      { leadId: 'L2', customerName: HANDEKO, totalPrice: 40000 },
    ];
    const currOrders: TestSiparis[] = [
      { leadId: 'L1', customerName: SIRIN, totalPrice: 130000 },
      { leadId: 'L3', customerName: CIMSA, totalPrice: 25000 },
    ];
    // ESKİ formül — `GenelBloklar3.tsx:428-435`, `:437-441` aynen (ad anahtarlı, korumasız reduce).
    const tp = (o: TestSiparis) => o.totalPrice as number;
    const prevRev = prevOrders.reduce((s, o) => s + tp(o), 0);
    const currRev = currOrders.reduce((s, o) => s + tp(o), 0);
    const prevCusts = new Set(prevOrders.map(o => o.customerName));
    const currCusts = new Set(currOrders.map(o => o.customerName));
    const newCustRev = currOrders.filter(o => !prevCusts.has(o.customerName)).reduce((s, o) => s + tp(o), 0);
    const retainedRev = currOrders.filter(o => prevCusts.has(o.customerName)).reduce((s, o) => s + tp(o), 0);
    const lostRev = prevOrders.filter(o => !currCusts.has(o.customerName)).reduce((s, o) => s + tp(o), 0);
    const retainedGrowth = retainedRev - (prevRev - lostRev);
    const netChange = currRev - prevRev;

    const k = ciroKopru(ozet(currOrders), ozet(prevOrders));

    expect(k.yeni.tutar).toBe(newCustRev);                       // 25.000
    expect(-k.kaybedilen.tutar).toBe(lostRev);                   // 40.000
    expect(k.buyuyen.tutar + k.kuculen.tutar).toBe(retainedGrowth); // 30.000
    expect(k.net).toBe(netChange);                               // 15.000
    expect(k.oncekiTaban).toBe(prevRev);                         // 140.000
    expect(k.buTaban).toBe(currRev);                             // 155.000

    expect(k.yeni).toEqual({ musteri: 1, tutar: 25000 });
    expect(k.kaybedilen).toEqual({ musteri: 1, tutar: -40000 });
    expect(k.buyuyen).toEqual({ musteri: 1, tutar: 30000 });
    expect(k.kuculen).toEqual({ musteri: 0, tutar: 0 });
    expect(k.sabit).toBe(0);
    expect(k.kapsananMusteri).toBe(3);
    expect(k.tutarsizMusteri).toBe(0);
    expect(k.tutarsizSiparis).toBe(0);
    expect(k.kimliksiz).toBe(0);
  });
});

describe('ciroKopru — K4 "kimlikle"', () => {
  it('2 · Cetpa kaydı (leadId) + Mikro carisi (mikroCariKod) bağ haritasıyla TEK müşteri', () => {
    const onceki: TestSiparis[] = [{ leadId: 'L1', customerName: SIRIN, totalPrice: 100000 }];
    const bu: TestSiparis[] = [{ mikroCariKod: 'C1', customerName: 'ŞİRİN İNŞ. SAN. TİC.', totalPrice: 130000 }];
    const harita = new Map([['L1', 'C1']]);

    const k = ciroKopru(ozet(bu, harita), ozet(onceki, harita));
    expect(k.kapsananMusteri).toBe(1);
    expect(k.buyuyen.musteri + k.kuculen.musteri).toBe(1);
    expect(k.buyuyen).toEqual({ musteri: 1, tutar: 30000 });
    expect(k.yeni.musteri).toBe(0);
    expect(k.kaybedilen.musteri).toBe(0);
    expect(k.net).toBe(30000);

    // MUTASYON kilidi: harita VERİLMEZSE bağ kurulmaz — aynı firma "1 yeni + 1 kaybedilen" görünür.
    // (Hakem maddesi 1: iki dönem farklı haritayla kurulursa da aynı arıza çıkar.)
    const bagsiz = ciroKopru(ozet(bu), ozet(onceki));
    expect(bagsiz.yeni).toEqual({ musteri: 1, tutar: 130000 });
    expect(bagsiz.kaybedilen).toEqual({ musteri: 1, tutar: -100000 });
    expect(bagsiz.buyuyen.musteri).toBe(0);
    expect(bagsiz.kapsananMusteri).toBe(2);
  });

  it('3 · aynı ad ≠ aynı müşteri: iki farklı kayıt aynı unvanla İKİ müşteridir', () => {
    const bu: TestSiparis[] = [
      { leadId: 'L1', customerName: SIRIN, totalPrice: 50000 },
      { leadId: 'L2', customerName: SIRIN, totalPrice: 20000 },
    ];
    const k = ciroKopru(ozet(bu), ozet([]));
    // MUTASYON: `:430` ad anahtarı → tek müşteri, `yeni.musteri` 1 eksik çıkar.
    expect(k.yeni).toEqual({ musteri: 2, tutar: 70000 });
    expect(k.kapsananMusteri).toBe(2);
    expect(k.buTaban).toBe(70000);
  });

  it('4 · kimliksiz sipariş SATIR değil SAYAÇ: kalemlere ve net\'e girmez', () => {
    const onceki: TestSiparis[] = [
      { leadId: 'L1', customerName: SIRIN, totalPrice: 100000 },
      { customerName: undefined, totalPrice: 5000 },
    ];
    const bu: TestSiparis[] = [
      { leadId: 'L1', customerName: SIRIN, totalPrice: 130000 },
      { customerName: undefined, totalPrice: 7000 },
    ];
    const k = ciroKopru(ozet(bu), ozet(onceki));
    expect(k.kimliksiz).toBe(2);
    expect(k.buyuyen).toEqual({ musteri: 1, tutar: 30000 });
    expect(k.yeni).toEqual({ musteri: 0, tutar: 0 });
    expect(k.kuculen).toEqual({ musteri: 0, tutar: 0 });
    expect(k.kaybedilen).toEqual({ musteri: 0, tutar: 0 });
    // MUTASYON: `Set([undefined])` → adsızlar "korunan" olur, net 32.000'e kayar.
    expect(k.net).toBe(30000);
    expect(k.oncekiTaban).toBe(100000);
    expect(k.buTaban).toBe(130000);
    expect(k.kapsananMusteri).toBe(1);
  });
});

describe('ciroKopru — bilinmeyen 0 sayılmaz (tamTutar sözleşmesi)', () => {
  it('yalnız KİMLİKSİZ siparişler: köprüye kimse giremedi → tutarlar NaN, "Net değişim ₺0" DEĞİL (inceleme 2026-09-25)', () => {
    const bu: TestSiparis[] = [{ customerName: undefined, totalPrice: 1000 }, { customerName: '', totalPrice: 3000 }];
    const onceki: TestSiparis[] = [{ totalPrice: 2000 }];
    const k = ciroKopru(ozet(bu), ozet(onceki));
    expect(k.kapsananMusteri).toBe(0);
    expect(k.kimliksiz).toBe(3);
    for (const v of [k.oncekiTaban, k.buTaban, k.net, k.yeni.tutar, k.buyuyen.tutar, k.kuculen.tutar, k.kaybedilen.tutar]) {
      expect(Number.isNaN(v)).toBe(true);
    }
    // Tamamen boş girdi hâlâ GERÇEK 0 (kapı genişlemesi boş dönemi bilinmeyen yapmaz)
    const bos = ciroKopru(ozet([]), ozet([]));
    expect(bos.net).toBe(0);
    expect(bos.buTaban).toBe(0);
  });

  it('5 · tutarı bilinmeyen siparişi olan müşteri köprüye GİRMEZ, SAYILIR (kısmi toplam sızmaz)', () => {
    const bu: TestSiparis[] = [
      { leadId: 'L1', customerName: SIRIN, totalPrice: 50000 },
      { leadId: 'L1', customerName: SIRIN, totalPrice: undefined },
    ];
    const onceki: TestSiparis[] = [{ leadId: 'L2', customerName: HANDEKO, totalPrice: 40000 }];
    const k = ciroKopru(ozet(bu), ozet(onceki));
    expect(k.tutarsizMusteri).toBe(1);
    expect(k.tutarsizSiparis).toBe(1);
    // MUTASYON: `ekranTutari` → kısmi ₺50.000 `buTaban`a ve `yeni`ye sızar.
    expect(k.buTaban).toBe(0);
    expect(k.yeni).toEqual({ musteri: 0, tutar: 0 });
    expect(k.buyuyen.musteri).toBe(0);
    expect(k.kuculen.musteri).toBe(0);
    expect(k.kapsananMusteri).toBe(1);                    // yalnız Handeko
    expect(k.kaybedilen).toEqual({ musteri: 1, tutar: -40000 });
    expect(k.oncekiTaban).toBe(40000);
    expect(k.net).toBe(-40000);
  });

  it('6 · bilinmeyen ÇİFT SAYILMAZ: iki dönemde de tutarsız müşteri BİR müşteri, siparişleri toplanır', () => {
    const onceki: TestSiparis[] = [
      { leadId: 'L1', customerName: SIRIN, totalPrice: undefined },
      { leadId: 'L1', customerName: SIRIN, totalPrice: null },
      { leadId: 'L2', customerName: HANDEKO, totalPrice: 40000 },
    ];
    const bu: TestSiparis[] = [
      { leadId: 'L1', customerName: SIRIN, totalPrice: 'abc' },
      { leadId: 'L2', customerName: HANDEKO, totalPrice: 45000 },
    ];
    const k = ciroKopru(ozet(bu), ozet(onceki));
    // MUTASYON: dönem başına sayım → 2.
    expect(k.tutarsizMusteri).toBe(1);
    expect(k.tutarsizSiparis).toBe(3);
    expect(k.kapsananMusteri).toBe(1);
    expect(k.buyuyen).toEqual({ musteri: 1, tutar: 5000 });
    expect(k.oncekiTaban).toBe(40000);                   // Şirin'in hiçbir dönemi tabana girmez
    expect(k.buTaban).toBe(45000);
  });

  it('7 · hiç kapsanan yok → tutarlar NaN (0 DEĞİL), sayaçlar olduğu gibi', () => {
    const onceki: TestSiparis[] = [{ leadId: 'L1', customerName: SIRIN, totalPrice: undefined }];
    const k = ciroKopru(ozet([]), ozet(onceki));
    // MUTASYON: 0 dönerse ekran "Net değişim ₺0" yalanı basar.
    expect(Number.isNaN(k.net)).toBe(true);
    expect(Number.isNaN(k.oncekiTaban)).toBe(true);
    expect(Number.isNaN(k.buTaban)).toBe(true);
    expect(Number.isNaN(k.yeni.tutar)).toBe(true);
    expect(Number.isNaN(k.buyuyen.tutar)).toBe(true);
    expect(Number.isNaN(k.kuculen.tutar)).toBe(true);
    expect(Number.isNaN(k.kaybedilen.tutar)).toBe(true);
    expect(k.tutarsizMusteri).toBe(1);
    expect(k.tutarsizSiparis).toBe(1);
    expect(k.kapsananMusteri).toBe(0);
    expect(k.yeni.musteri + k.buyuyen.musteri + k.kuculen.musteri + k.kaybedilen.musteri).toBe(0);
    expect(k.sabit).toBe(0);
    expect(k.kimliksiz).toBe(0);
  });

  it('8 · boş girdi GERÇEK 0 (hareketsiz dönemler), hiçbiri NaN değil', () => {
    const k = ciroKopru(ozet([]), ozet([]));
    expect(k).toEqual({
      oncekiTaban: 0, buTaban: 0, net: 0,
      yeni: { musteri: 0, tutar: 0 },
      buyuyen: { musteri: 0, tutar: 0 },
      kuculen: { musteri: 0, tutar: 0 },
      kaybedilen: { musteri: 0, tutar: 0 },
      sabit: 0, kapsananMusteri: 0, tutarsizMusteri: 0, tutarsizSiparis: 0, kimliksiz: 0,
    });
    for (const v of [k.oncekiTaban, k.buTaban, k.net, k.yeni.tutar, k.kaybedilen.tutar]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('ciroKopru — değişmezler', () => {
  it('9 · ÖZDEŞLİK: oncekiTaban + net ≈ buTaban ve net = dört kalemin toplamı', () => {
    const k = ciroKopru(ozet(KARISIK.bu), ozet(KARISIK.onceki));
    expect(k.oncekiTaban + k.net).toBeCloseTo(k.buTaban, 6);
    expect(k.net).toBeCloseTo(k.yeni.tutar + k.buyuyen.tutar + k.kuculen.tutar + k.kaybedilen.tutar, 6);
    // Kalem sayaçları fikstürle birebir; tutarsız müşterinin BİLİNEN dönemi de tabana girmez (₺10.000 yok).
    expect(k.yeni.musteri).toBe(1);
    expect(k.buyuyen.musteri).toBe(1);
    expect(k.kuculen.musteri).toBe(1);
    expect(k.kaybedilen.musteri).toBe(1);
    expect(k.sabit).toBe(1);
    expect(k.tutarsizMusteri).toBe(1);
    expect(k.tutarsizSiparis).toBe(1);
    expect(k.kimliksiz).toBe(2);
    expect(k.kapsananMusteri).toBe(5);
    expect(k.oncekiTaban).toBeCloseTo(100000.15 + 80000.33 + 40000.07 + 75000, 6);
    expect(k.buTaban).toBeCloseTo(25000.5 + 130000.42 + 60000.11 + 75000, 6);
  });

  it('10 · SAYIM: kalemler + sabit + tutarsız = iki dönemin benzersiz anahtar sayısı', () => {
    const bu = ozet(KARISIK.bu);
    const onceki = ozet(KARISIK.onceki);
    const benzersiz = new Set([...bu.musteriler, ...onceki.musteriler].map(m => m.anahtar)).size;
    const k = ciroKopru(bu, onceki);
    expect(benzersiz).toBe(6);
    expect(
      k.yeni.musteri + k.buyuyen.musteri + k.kuculen.musteri + k.kaybedilen.musteri + k.sabit + k.tutarsizMusteri,
    ).toBe(benzersiz);
    expect(k.kapsananMusteri + k.tutarsizMusteri).toBe(benzersiz);
  });

  it('11 · sabit: fark TAM 0 hiçbir kaleme girmez, sayılır', () => {
    const k = ciroKopru(
      ozet([{ leadId: 'L1', customerName: SIRIN, totalPrice: 75000 }]),
      ozet([{ leadId: 'L1', customerName: SIRIN, totalPrice: 75000 }]),
    );
    // MUTASYON: `d >= 0 ? buyuyen : kuculen` → `buyuyen.musteri` 1.
    expect(k.sabit).toBe(1);
    expect(k.buyuyen).toEqual({ musteri: 0, tutar: 0 });
    expect(k.kuculen).toEqual({ musteri: 0, tutar: 0 });
    expect(k.net).toBe(0);
    expect(k.kapsananMusteri).toBe(1);
    expect(k.oncekiTaban).toBe(75000);
    expect(k.buTaban).toBe(75000);
  });

  it('12 · meşru ₺0 ciro DÜŞMEZ: müşteri kalır, tutar 0 (NaN değil)', () => {
    const k = ciroKopru(ozet([{ leadId: 'L1', customerName: SIRIN, totalPrice: 0 }]), ozet([]));
    // MUTASYON: `if (!bT) continue` ya da `bT > 0` kapısı → müşteri kaybolur.
    expect(k.yeni).toEqual({ musteri: 1, tutar: 0 });
    expect(Number.isNaN(k.yeni.tutar)).toBe(false);
    expect(k.kapsananMusteri).toBe(1);
    expect(k.tutarsizMusteri).toBe(0);
    expect(k.buTaban).toBe(0);
    expect(k.net).toBe(0);
  });

  it('13 · işaret MODÜLDE: küçülen ve kaybedilen NEGATİF, yeni ve büyüyen pozitif', () => {
    const k = ciroKopru(ozet(KARISIK.bu), ozet(KARISIK.onceki));
    expect(k.kuculen.tutar).toBeLessThan(0);
    expect(k.kaybedilen.tutar).toBeLessThan(0);
    expect(k.yeni.tutar).toBeGreaterThanOrEqual(0);
    expect(k.buyuyen.tutar).toBeGreaterThan(0);
    expect(k.kuculen.tutar).toBeCloseTo(60000.11 - 80000.33, 6);   // −20.000,22
    expect(k.kaybedilen.tutar).toBeCloseTo(-40000.07, 6);
    expect(k.yeni.tutar).toBeCloseTo(25000.5, 6);
    expect(k.buyuyen.tutar).toBeCloseTo(130000.42 - 100000.15, 6); // +30.000,27
  });

  it('14 · parametre sırası anlam taşır (bu ÖNCE) + girdi mutasyona uğramaz', () => {
    const bu = ozet(KARISIK.bu);
    const onceki = ozet(KARISIK.onceki);
    const ileri = ciroKopru(bu, onceki);
    const ters = ciroKopru(onceki, bu);
    expect(ters.yeni.musteri).toBe(ileri.kaybedilen.musteri);
    expect(ters.yeni.tutar).toBeCloseTo(-ileri.kaybedilen.tutar, 6);
    expect(ters.kaybedilen.musteri).toBe(ileri.yeni.musteri);
    expect(ters.kaybedilen.tutar).toBeCloseTo(-ileri.yeni.tutar, 6);
    expect(ters.buyuyen.musteri).toBe(ileri.kuculen.musteri);
    expect(ters.buyuyen.tutar).toBeCloseTo(-ileri.kuculen.tutar, 6);
    expect(ters.net).toBeCloseTo(-ileri.net, 6);
    // Tabanlar toplama SIRASINA bağlı (anahtar gezinme sırası argüman sırasını izler) → kuruş altı sapma meşru.
    expect(ters.oncekiTaban).toBeCloseTo(ileri.buTaban, 6);
    expect(ters.buTaban).toBeCloseTo(ileri.oncekiTaban, 6);

    // Dondurulmuş girdiyle çağrı HATA ATMAZ (ES modülü = katı kip: yazma girişimi TypeError fırlatırdı).
    const donmusBu = ozet(KARISIK.bu);
    const donmusOnceki = ozet(KARISIK.onceki);
    for (const oz of [donmusBu, donmusOnceki]) {
      for (const m of oz.musteriler) { Object.freeze(m.ciro); Object.freeze(m); }
      Object.freeze(oz.musteriler);
      Object.freeze(oz);
    }
    const ilkNesne = donmusBu.musteriler[0];
    const siraOnce = donmusBu.musteriler.map(m => m.anahtar);
    expect(() => ciroKopru(donmusBu, donmusOnceki)).not.toThrow();
    expect(donmusBu.musteriler[0]).toBe(ilkNesne);
    expect(donmusBu.musteriler.map(m => m.anahtar)).toEqual(siraOnce);
    expect(ciroKopru(donmusBu, donmusOnceki)).toEqual(ileri);
  });
});
