/**
 * raporMarj.test.ts — Raporlar'ın brüt marj/kâr hesabının sözleşmesi (Faz 3 5/n düzeltici turu,
 * 2026-09-19). ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * ## Düzeltilen sahte kesinlik siteleri (src/components/reports/useReportsData.ts `brutMarj`)
 *
 *   329  `const ciro = ekranTutari(ciroTutar)` + `const maliyet = kapsamli.reduce(...)`
 *        Ciro tarafı tutarı okunamayan siparişi DIŞLIYOR, maliyet tarafı AYNI siparişin kalem
 *        maliyetini toplamaya devam ediyordu. `ciro − maliyet` yazan tüketiciler (IKRapor:631,
 *        GenelBloklar2:249) kısmi cirodan TAM maliyeti çıkarıp brüt kâr üretiyordu; IKRapor'daki
 *        "brüt kâr bu kayıtları İÇERMEZ" notu da bu yüzden yanlıştı (maliyetleri içerideydi).
 *
 *   335  `inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6`
 *        İki ayrı uydurma: (a) envanterde eşleşmeyen kaleme hiçbir veriye dayanmayan **%60 sabit
 *        maliyet oranı** ("Nakliye bedeli ₺5.000" → ₺3.000 maliyet → kesin bir %40 marj);
 *        (b) `itemCostTRY` kuru çevrilemeyen kalem için 0 döner (cost.ts'te belgeli), yani kalem
 *        sessizce "bedelsiz" olup marjı şişiriyordu. Aynı iki davranış Pano'nun Phase 124
 *        "Segment Kârlılığı" panelinde KALDIRILMIŞTI — aynı sipariş iki ekranda iki farklı marj
 *        veriyordu (yarım düzeltme sınıfı).
 *
 *        Ayrıca BOŞ ANAHTAR EŞLEŞMESİ: `ii.id === li.inventoryId || ii.name === li.name` kuralı
 *        `'' === ''` / `undefined === undefined` olduğu için serbest satırı katalogdaki adsız
 *        İLK karta bağlıyordu.
 *
 * ## Sözleşme (src/utils/para.ts — İKİ SÖZLEŞME)
 *   • `ciro` / `maliyet` / `toplamCiro`: EKRAN toplamı (kısmi + "N kayıt tutarsız" notu).
 *   • `brutKar` / `marj`: TÜRETME — ciro ya da maliyet tarafında TEK bilinmeyen bile varsa
 *     hesaplanmaz (NaN / null → '—', yüzde çubuğu ve renk rozeti ÇİZİLMEZ).
 *
 * ## Parite
 * Tüm kalemleri katalogda eşleşen ve maliyeti/tutarı bilinen siparişlerde sayılar eski
 * reduce'larla BİREBİR aynıdır.
 */
import { describe, it, expect } from 'vitest';
import { brutMarjHesabi, stokMaliyetCozucu, stokKartiCozucu, stokDevirGunu, marjCirosu, type MarjSiparisi } from './raporMarj';
import { ekranTutari } from '../para';

// ── Şirin İnşaat (inşaat malzemesi toptancısı) ───────────────────────────────────
const KATALOG = [
  { id: 'p1', name: 'ÇİMENTO 50KG', birim: 180 },
  { id: 'p2', name: 'İNŞAAT DEMİRİ 12MM', birim: 1_250 },
  { id: 'p3', name: 'TUĞLA', birim: null },          // kartta maliyet girilmemiş
];
const cozucu = stokMaliyetCozucu(KATALOG, k => k.birim);

/** Tam bilinen sipariş: 200 çimento @ ₺260, başlık ₺52.000. */
const tamSiparis: MarjSiparisi = {
  totalPrice: 52_000,
  lineItems: [{ inventoryId: 'p1', name: 'ÇİMENTO 50KG', price: 260, quantity: 200 }],
};
/** İkinci tam sipariş: 10 demir @ ₺1.800, başlık ₺18.000. */
const tamSiparis2: MarjSiparisi = {
  totalPrice: 18_000,
  lineItems: [{ inventoryId: 'p2', name: 'İNŞAAT DEMİRİ 12MM', price: 1_800, quantity: 10 }],
};

describe('brutMarjHesabi — parite (her şey bilinen siparişler)', () => {
  it('ciro/maliyet/kâr/marj eski reduce ile BİREBİR aynı', () => {
    const o = brutMarjHesabi([tamSiparis, tamSiparis2], cozucu);
    expect(ekranTutari(o.ciroTutar)).toBe(70_000);            // 52.000 + 18.000
    expect(o.maliyet).toBe(48_500);                           // 180×200 + 1250×10
    expect(o.brutKar).toBe(21_500);
    expect(o.marj).toBe(Math.round((21_500 / 70_000) * 100)); // 31
    expect(o.kapsamDisi).toBe(0);
    expect(o.maliyetTutar.bilinmeyen).toBe(0);
  });

  it('kalem verisi olmayan sipariş marj KAPSAMI dışındadır ama toplam ciroya girer', () => {
    const mikroTuretmesi: MarjSiparisi = { totalPrice: 30_000, lineItems: [] };
    const o = brutMarjHesabi([tamSiparis, mikroTuretmesi], cozucu);
    expect(o.kapsamDisi).toBe(1);
    expect(ekranTutari(o.toplamCiroTutar)).toBe(82_000);
    expect(ekranTutari(o.ciroTutar)).toBe(52_000);
    expect(o.marj).toBe(Math.round(((52_000 - 36_000) / 52_000) * 100));
  });

  it('hiç sipariş yoksa marj YOK (%0 değil); kâr ise GERÇEK 0 (hareket yok)', () => {
    const o = brutMarjHesabi([], cozucu);
    expect(o.marj).toBeNull();          // eski kod `: 0` ile "%0 marj" basıyordu
    expect(o.brutKar).toBe(0);          // boş liste bir bilinmeyen değil: ciro 0, maliyet 0
    expect(o.ciro).toBe(0);
  });
});

describe('brutMarjHesabi — ciro/maliyet ASİMETRİSİ kapatıldı', () => {
  /** Kalemi olan ama BAŞLIK TUTARI okunamayan sipariş (Mikro `sip_tutar` NULL, sentetik kayıt…). */
  const tutarsiz: MarjSiparisi = {
    lineItems: [{ inventoryId: 'p1', name: 'ÇİMENTO 50KG', price: 260, quantity: 200 }],
  };

  it('MUTASYON-AYIRT EDİCİ — tutarı okunamayan siparişin MALİYETİ de kârdan düşülmez', () => {
    const o = brutMarjHesabi([tamSiparis2, tutarsiz], cozucu);
    expect(o.ciroTutar.bilinmeyen).toBe(1);
    // Brüt kâr TÜRETMEDİR: kısmi cirodan üretilmez.
    expect(o.brutKar).toBeNaN();
    expect(o.marj).toBeNull();
    // Eski davranış: ciro 18.000 (kısmi), maliyet 48.500 (tam) → kâr −30.500 diye basılıyordu.
    expect(ekranTutari(o.ciroTutar) - o.maliyet).toBe(-30_500);
    expect(o.brutKar).not.toBe(-30_500);
  });

  it('TÜM kalemli siparişlerin tutarı bilinmiyorsa ekran cirosu da NaN ("NaN×" değil, "—")', () => {
    const o = brutMarjHesabi([tutarsiz], cozucu);
    expect(ekranTutari(o.ciroTutar)).toBeNaN();
    expect(o.brutKar).toBeNaN();
    expect(o.marj).toBeNull();
  });
});

/**
 * `tutarsizSiparis` — KARTA BASILACAK sayaç. `ciroTutar.bilinmeyen + maliyetTutar.bilinmeyen`
 * TOPLAMA: iki sayaç AYNI `kapsamli` kümesi üzerinden çıkar ve kesişir — hem tutarı hem maliyeti
 * okunamayan TEK sipariş "2 sipariş" diye raporlanır. `finansKpi.nakitPozisyonu` aynı arızayı
 * Phase 130'da Set ile kapatmıştı (`tutarsizKayit`); rapor tarafındaki kopyada tekilleştirme de
 * test de yoktu (GenelBloklar1:45, GenelBloklar2:254 — Faz 3 5/n delta bulgusu).
 */
describe('brutMarjHesabi — tutarsiz sipariş sayacı TEKİLLEŞTİRİLİR', () => {
  /** Hem başlık tutarı hem kalem maliyeti okunamayan TEK sipariş (serbest "Nakliye bedeli" satırı). */
  const ikiYonluTutarsiz: MarjSiparisi = {
    lineItems: [{ name: 'Nakliye bedeli', price: 5_000, quantity: 1 }],
  };

  it('MUTASYON-AYIRT EDİCİ: iki yönü de bilinmeyen TEK sipariş bir kez sayılır', () => {
    const o = brutMarjHesabi([tamSiparis, ikiYonluTutarsiz], cozucu);
    // İki ayrı sayaç hâlâ kendi kümesini sayar (naif toplam 2 derdi)…
    expect(o.ciroTutar.bilinmeyen).toBe(1);
    expect(o.maliyetTutar.bilinmeyen).toBe(1);
    expect(o.ciroTutar.bilinmeyen + o.maliyetTutar.bilinmeyen).toBe(2);
    // …ama karta basılan benzersiz sayaç 1'dir.
    expect(o.tutarsizSiparis).toBe(1);
  });

  it('kesişmeyen iki sipariş (biri tutarsız, biri maliyetsiz) 2 sayılır', () => {
    const yalnizTutarsiz: MarjSiparisi = {
      lineItems: [{ inventoryId: 'p1', name: 'ÇİMENTO 50KG', price: 260, quantity: 200 }],
    };
    const yalnizMaliyetsiz: MarjSiparisi = {
      totalPrice: 5_000,
      lineItems: [{ name: 'Nakliye bedeli', price: 5_000, quantity: 1 }],
    };
    const o = brutMarjHesabi([tamSiparis, yalnizTutarsiz, yalnizMaliyetsiz], cozucu);
    expect(o.tutarsizSiparis).toBe(2);
  });

  it('her şeyi bilinen listede sayaç 0, kalemsiz sipariş buraya GİRMEZ (o `kapsamDisi`)', () => {
    const kalemsiz: MarjSiparisi = { totalPrice: 9_000, lineItems: [] };
    const o = brutMarjHesabi([tamSiparis, tamSiparis2, kalemsiz], cozucu);
    expect(o.tutarsizSiparis).toBe(0);
    expect(o.kapsamDisi).toBe(1);
  });

  it('aynı alanları taşıyan İKİ ayrı kayıt ayrı sayılır (kimlik değil, her kayıt bir kez)', () => {
    const o = brutMarjHesabi([{ ...ikiYonluTutarsiz }, { ...ikiYonluTutarsiz }], cozucu);
    expect(o.tutarsizSiparis).toBe(2);
  });
});

describe('brutMarjHesabi — uydurma maliyet kaldırıldı', () => {
  it('MUTASYON-AYIRT EDİCİ — katalogda eşleşmeyen kalem %60 oranıyla DEĞİL, bilinmiyor sayılır', () => {
    const serbest: MarjSiparisi = {
      totalPrice: 5_000,
      lineItems: [{ price: 5_000, quantity: 1, name: 'Nakliye bedeli' }],
    };
    const o = brutMarjHesabi([serbest], cozucu);
    expect(o.maliyetTutar.bilinmeyen).toBe(1);
    expect(o.brutKar).toBeNaN();
    expect(o.marj).toBeNull();               // eski kod ₺3.000 maliyetle kesin "%40" basıyordu
  });

  it('MUTASYON-AYIRT EDİCİ — maliyeti çözülemeyen kart (kur yok / kartta maliyet yok) 0 SAYILMAZ', () => {
    const tugla: MarjSiparisi = {
      totalPrice: 4_000,
      lineItems: [{ inventoryId: 'p3', name: 'TUĞLA', price: 4, quantity: 1_000 }],
    };
    const o = brutMarjHesabi([tugla], cozucu);
    expect(o.maliyetTutar.bilinmeyen).toBe(1);
    expect(o.marj).toBeNull();               // eski kod itemCostTRY=0 ile "%100 marj" basıyordu
    expect(o.marj).not.toBe(100);
  });

  it('KARIŞIK sipariş: tek kalemin maliyeti bilinmiyorsa SİPARİŞİN maliyeti bilinmez', () => {
    const karisik: MarjSiparisi = {
      totalPrice: 56_000,
      lineItems: [
        { inventoryId: 'p1', name: 'ÇİMENTO 50KG', price: 260, quantity: 200 },
        { inventoryId: 'p3', name: 'TUĞLA', price: 4, quantity: 1_000 },
      ],
    };
    const o = brutMarjHesabi([karisik], cozucu);
    expect(o.maliyetTutar.bilinmeyen).toBe(1);
    expect(o.maliyetTutar.bilinen).toBe(0);
    expect(o.brutKar).toBeNaN();
  });

  it('kısmi maliyet EKRAN toplamı olarak yine gösterilir (DIO gibi tüketiciler için)', () => {
    const serbest: MarjSiparisi = { totalPrice: 5_000, lineItems: [{ price: 5_000, quantity: 1, name: 'Nakliye bedeli' }] };
    const o = brutMarjHesabi([tamSiparis, serbest], cozucu);
    expect(o.maliyet).toBe(36_000);          // bilinen tek siparişin maliyeti
    expect(o.maliyetTutar.bilinmeyen).toBe(1);
    expect(o.brutKar).toBeNaN();             // ama TÜRETME yapılmaz
  });
});

describe('stokMaliyetCozucu — BOŞ ANAHTAR EŞLEŞMEZ', () => {
  it("MUTASYON-AYIRT EDİCİ — adsız/kimliksiz serbest satır katalogdaki adsız karta BAĞLANMAZ", () => {
    const bozukKatalog = [{ id: '', name: '', birim: 999 }, ...KATALOG];
    const c = stokMaliyetCozucu(bozukKatalog, k => k.birim);
    expect(c({ price: 5_000, quantity: 1 })).toBeNull();
    expect(c({ inventoryId: '', name: '', price: 5_000, quantity: 1 })).toBeNull();
    // eski `ii.id === li.inventoryId || ii.name === li.name` kuralı 999 döndürüyordu
    expect(c({ price: 5_000, quantity: 1 })).not.toBe(999);
  });

  it('kimlik ya da ad tutuyorsa eşleşir (eski OR sırası korundu)', () => {
    expect(cozucu({ inventoryId: 'p1', price: 1, quantity: 1 })).toBe(180);
    expect(cozucu({ name: 'İNŞAAT DEMİRİ 12MM', price: 1, quantity: 1 })).toBe(1_250);
  });

  it('kalemin KENDİ costPrice alanı varsa katalog aranmaz (meşru ₺0 dahil)', () => {
    const o = brutMarjHesabi([{
      totalPrice: 1_000,
      lineItems: [{ name: 'Promosyon numune', price: 1_000, quantity: 1, costPrice: 0 }],
    }], cozucu);
    expect(o.maliyet).toBe(0);
    expect(o.maliyetTutar.bilinmeyen).toBe(0);
    expect(o.brutKar).toBe(1_000);
  });
});

describe('brutMarjHesabi — miktar/kalem alanı bilinmiyorsa', () => {
  it('miktarı bilinmeyen kalem maliyeti BİLİNMEZ (null × miktar = 0 tuzağı)', () => {
    const o = brutMarjHesabi([{
      totalPrice: 10_000,
      lineItems: [{ inventoryId: 'p1', name: 'ÇİMENTO 50KG', price: 260, quantity: null }],
    }], cozucu);
    expect(o.maliyetTutar.bilinmeyen).toBe(1);
    expect(o.brutKar).toBeNaN();
  });

  it('marj ciro ≤ 0 iken de hesaplanmaz (sıfıra bölme / "%100" değil)', () => {
    const o = brutMarjHesabi([{
      totalPrice: 0,
      lineItems: [{ inventoryId: 'p1', name: 'ÇİMENTO 50KG', price: 0, quantity: 1 }],
    }], cozucu);
    expect(o.marj).toBeNull();
  });
});


describe('stokDevirGunu (DIO) — TÜRETME: payda eksikse HESAPLANMAZ', () => {
  const T = (toplam: number, bilinen: number, bilinmeyen: number) => ({ toplam, bilinen, bilinmeyen });

  it('her şey biliniyor → stok / günlük COGS (yuvarlanmış)', () => {
    // 90 günde COGS ₺900.000 → günlük ₺10.000; stok ₺390.000 → 39 gün
    expect(stokDevirGunu(390_000, { maliyetTutar: T(900_000, 10, 0), kapsamDisi: 0 }, 90)).toEqual({ dio: 39, neden: null });
  });

  it('maliyeti çözülemeyen tek sipariş → null + neden', () => {
    expect(stokDevirGunu(390_000, { maliyetTutar: T(900_000, 10, 1), kapsamDisi: 0 }, 90)).toEqual({ dio: null, neden: 'maliyet-bilinmiyor' });
  });

  it('[SON İNCELEME] kalemsiz (kapsam dışı) sipariş varsa da null — pay TÜM stok, payda yalnız kalemli küme', () => {
    // 300 kalemsiz Mikro faturası + COGS'u ₺200.000 olan 10 kalemli sipariş, stok ₺3M:
    // eski kod 1350 gün + "nakit sıkışıklığı riski var" basıyordu (gerçek ≈ 39 gün).
    expect(stokDevirGunu(3_000_000, { maliyetTutar: T(200_000, 10, 0), kapsamDisi: 300 }, 90)).toEqual({ dio: null, neden: 'kalemsiz-siparis' });
    expect(stokDevirGunu(3_000_000, { maliyetTutar: T(200_000, 10, 0), kapsamDisi: 1 }, 90).dio).toBeNull();
  });

  it('iki neden birden varsa ÖNCE maliyet söylenir (metin tek neden basar)', () => {
    expect(stokDevirGunu(1, { maliyetTutar: T(1, 1, 2), kapsamDisi: 5 }, 90).neden).toBe('maliyet-bilinmiyor');
  });

  it('kapsamlı sipariş yok / COGS 0 → null + neden (sıfıra bölme yok)', () => {
    expect(stokDevirGunu(390_000, { maliyetTutar: T(0, 0, 0), kapsamDisi: 0 }, 90)).toEqual({ dio: null, neden: 'maliyetli-siparis-yok' });
  });

  it('stok değeri ya da gün sayısı bilinmiyorsa null (NaN gün basılmaz)', () => {
    expect(stokDevirGunu(NaN, { maliyetTutar: T(900_000, 10, 0), kapsamDisi: 0 }, 90)).toEqual({ dio: null, neden: 'stok-bilinmiyor' });
    expect(stokDevirGunu(390_000, { maliyetTutar: T(900_000, 10, 0), kapsamDisi: 0 }, 0).dio).toBeNull();
  });
});

// ── stokKartiCozucu (6a ADDITIVE, 2026-09-19) ────────────────────────────────────
// `stokMaliyetCozucu` gövdesinden çıkarılan KART eşleşmesi. Yukarıdaki mevcut vakalar
// DÜZENLENMEDEN yeşil kalmalı (maliyet çözücüsünün imzası/davranışı değişmedi).
describe('stokKartiCozucu — kart eşleşmesi tek evde', () => {
  const kartCoz = stokKartiCozucu(KATALOG);

  it('kimlik ya da ad tutuyorsa eşleşir; eşleşme liste sırasındaki İLK karttır (OR semantiği AYNEN)', () => {
    expect(kartCoz({ inventoryId: 'p1', price: 1, quantity: 1 })).toBe(KATALOG[0]);
    expect(kartCoz({ name: 'İNŞAAT DEMİRİ 12MM', price: 1, quantity: 1 })).toBe(KATALOG[1]);
    // adı 1. kartı, kimliği 2. kartı tutuyor → kimliğe öncelik VERİLMEZ, liste sırası kazanır
    expect(kartCoz({ inventoryId: 'p2', name: 'ÇİMENTO 50KG', price: 1, quantity: 1 })).toBe(KATALOG[0]);
  });

  it('MUTASYON-AYIRT EDİCİ — boş kimlik/ad katalogdaki boş anahtarlı karta BAĞLANMAZ', () => {
    const bozukKatalog = [{ id: '', name: '', birim: 999 }, ...KATALOG];
    const c = stokKartiCozucu(bozukKatalog);
    expect(c({ price: 5_000, quantity: 1 })).toBeNull();
    expect(c({ inventoryId: '', name: '', price: 5_000, quantity: 1 })).toBeNull();
    expect(c({ inventoryId: '  ', name: '  ', price: 5_000, quantity: 1 })).toBeNull();
  });

  it('eşleşme yoksa null (maliyet çözücüsünün "bilinmiyor" kapısı)', () => {
    expect(kartCoz({ inventoryId: 'yok', name: 'Nakliye bedeli', price: 5_000, quantity: 1 })).toBeNull();
  });

  it('`costPrice` kapısı BURADA YOK — o yalnız stokMaliyetCozucu\'nun işi', () => {
    expect(kartCoz({ inventoryId: 'p1', costPrice: 0, price: 1, quantity: 1 })).toBe(KATALOG[0]);
  });
});

// İnceleme 2026-09-25: faturadan-sipariş importu MF siparişine sürüm-2 kalem yazınca sipariş marj kapsamına girdi; ciro
// `totalPrice` (KDV + masraf DÂHİL) iken maliyet KDV hariç → marj şişerdi. Ciro artık Σ netTutar (K-KALEM).
describe('marjCirosu + sku eşleşmesi — sürüm-2 MF siparişi', () => {
  const mf = (kalemler: Record<string, unknown>[]) => ({ source: 'mikro-fatura', totalPrice: 2160, lineItems: kalemler });
  it('tüm kalemler sürüm 2 → ciro Σ netTutar (KDV hariç); tek net bilinmiyorsa NaN; eski kalem/native → raporSiparisi', () => {
    expect(marjCirosu(mf([{ netTutar: 1500, kalemSurumu: 2 }, { netTutar: 300, kalemSurumu: 2 }]) as never)).toBe(1800);
    expect(Number.isNaN(marjCirosu(mf([{ netTutar: null, kalemSurumu: 2 }]) as never))).toBe(true);
    expect(Number.isNaN(marjCirosu(mf([{ total: 2160 }]) as never))).toBe(true);   // eski MF kalemi: net yok → bilinmez
    expect(marjCirosu({ totalPrice: 500, lineItems: [{ price: 5, quantity: 100 }] } as never)).toBe(500);
  });
  it('brutMarjHesabi v2 MF siparişinde KDV hariç ciroyla marj üretir; kart SKU ile bulunur', () => {
    const kartlar = [{ id: 'k1', sku: 'CMT-50', name: 'ÇİMENTO (kart adı farklı)', maliyet: 120 }];
    const cozucu = stokMaliyetCozucu(kartlar, k => k.maliyet);
    const r = brutMarjHesabi([mf([{ sku: 'CMT-50', name: 'ÇİMENTO 50KG', quantity: 10, netTutar: 1800, kalemSurumu: 2 }]) as never], cozucu);
    expect(r.ciro).toBe(1800);
    expect(r.maliyet).toBe(1200);
    expect(r.marj).toBe(33);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6c EKİ (2026-10-17): `hamMarj` — HAM (yuvarlanmamış) brüt marj yüzdesi (O13; aylık eğilim yardımcısı O23 ile YAZILMADI — GB4 P306 K14 gereği kalktı)
//   GenelBloklar4 P22 P&L: `Gross margin: {revenue>0?((grossProfit/revenue)*100).toFixed(1):0}%`
//     → hesaplanamayan marj sahte "0%" (`: 0`); brüt kâr `brutMarjHesabi`'ndan gelince `BrutMarjSonucu.marj`
//       `Math.round`'lu olduğu için 1 ondalıkla BASILAMAZ ("yuvarlanmış girdiye ondalık" arızası)
// Kural: oran `brutKar / tamTutar(ciroTutar) × 100` — payda marj KAPSAMINDAKİ ciro (O12), başlık cirosu değil.
// O21: TRY dışı mağaza siparişi `brutMarjHesabi`'na ULAŞMAZ — ayrım ÇAĞIRANDA.
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { hamMarj, type BrutMarjSonucu } from './raporMarj';
import { tryDisiMi } from '../siparisler/magazaSiparisi';

/** Şirin İnşaat — ÇİMENTO 50KG siparişi: `adet` torba @ `fiyat`, kalemin KENDİ maliyeti `maliyet`. */
const cimentoSiparisi = (fiyat: number, adet: number, maliyet: number): MarjSiparisi => ({
  totalPrice: fiyat * adet,
  lineItems: [{ inventoryId: 'p1', name: 'ÇİMENTO 50KG', price: fiyat, quantity: adet, costPrice: maliyet }],
});

describe('hamMarj — 6c eki (O13)', () => {
  it('1 · PARİTE + DEĞİŞMEZ: ciro ₺1.500, maliyet ₺1.000 → (500 / 1500) × 100; Math.round(ham) === marj', () => {
    const s = brutMarjHesabi([cimentoSiparisi(150, 10, 100)], cozucu);
    expect(hamMarj(s)).toBe((500 / 1500) * 100);
    expect(s.marj).toBe(33);
    expect(Math.round(hamMarj(s) as number)).toBe(s.marj);
  });

  it('2 · null kapıları: maliyet çözülemedi → null; kapsamda ciro 0 → null (0 DEĞİL); zarar BİLİNEN değerdir', () => {
    const maliyetsiz = brutMarjHesabi([{ totalPrice: 4000, lineItems: [{ inventoryId: 'p3', name: 'TUĞLA', price: 4, quantity: 1000 }] }], cozucu);
    expect(Number.isNaN(maliyetsiz.brutKar)).toBe(true);
    expect(hamMarj(maliyetsiz)).toBeNull();
    const kalemsiz = brutMarjHesabi([{ totalPrice: 5000 }], cozucu);         // yalnız kalemsiz (Mikro türevi) sipariş
    expect(kalemsiz.kapsamDisi).toBe(1);
    expect(hamMarj(kalemsiz)).toBeNull();
    const zarar = brutMarjHesabi([cimentoSiparisi(100, 10, 125)], cozucu);   // ciro ₺1.000, maliyet ₺1.250
    expect(hamMarj(zarar)).toBe(-25);
    expect(zarar.marj).toBe(-25);
  });

  it('3 · MUTASYON-AYIRT EDİCİ: yuvarlanmamış — ciro ₺3.000, maliyet ₺2.000 → 33,333… (marj 33)', () => {
    const s = brutMarjHesabi([cimentoSiparisi(300, 10, 200)], cozucu);
    expect(hamMarj(s)).toBeCloseTo(100 / 3, 9);
    expect(hamMarj(s)).not.toBe(33);
    expect(s.marj).toBe(33);
  });

  it('3b · DEĞİŞMEZ: hamMarj === null ⇔ marj === null; değilse Math.round(ham) === marj', () => {
    const vakalar: BrutMarjSonucu[] = [
      brutMarjHesabi([cimentoSiparisi(150, 10, 100), tamSiparis, tamSiparis2], cozucu),
      brutMarjHesabi([cimentoSiparisi(99.5, 7, 81.25)], cozucu),
      brutMarjHesabi([cimentoSiparisi(100, 10, 125)], cozucu),
      brutMarjHesabi([{ totalPrice: 5000 }], cozucu),
      brutMarjHesabi([{ totalPrice: undefined, lineItems: [{ inventoryId: 'p1', name: 'ÇİMENTO 50KG', price: 1, quantity: 1 }] }], cozucu),
      brutMarjHesabi([], cozucu),
      // 6c inceleme 1: iade ağırlıklı sipariş — ciro −₺1.000 (10 × −₺100), maliyet ₺800 → marj null; ham da null (`ciroTam > 0` kapısı).
      brutMarjHesabi([cimentoSiparisi(-100, 10, 80)], cozucu),
    ];
    for (const s of vakalar) {
      const h = hamMarj(s);
      expect(h === null).toBe(s.marj === null);
      if (h !== null) expect(Math.round(h)).toBe(s.marj);
    }
  });

  it('4 · O21: TRY dışı sipariş `brutMarjHesabi`\'na ulaşırsa marj \'—\'; ulaşmamalı (ayrım çağıranda)', () => {
    type MagazaliMarj = MarjSiparisi & { source?: string; status?: string; paraBirimi?: string; dovizTutar?: number; customerName?: string };
    const x: MagazaliMarj[] = [
      { totalPrice: 1500, status: 'Delivered', lineItems: cimentoSiparisi(150, 10, 100).lineItems },   // Şirin İnşaat — TL
      // TRY dışı mağaza siparişi — sunucu `totalPrice` YAZMAZ (shopifyEsleme TRY dışı yazımı); kalemi maliyetli.
      { source: 'shopify_webhook', paraBirimi: 'EUR', dovizTutar: 50, customerName: 'Kaya Hırdavat', status: 'Delivered',
        lineItems: [{ inventoryId: 'p1', name: 'ÇİMENTO 50KG', quantity: 5, costPrice: 100, netTutar: 50 }] },
    ];
    // (a) süzgeçsiz — 50 EUR TL ciroya EKLENMEDİ, «tutarı bilinmeyen» → marj hesaplanmaz.
    const a = brutMarjHesabi(x, cozucu);
    expect(hamMarj(a)).toBeNull();
    expect(a.ciroTutar.bilinmeyen).toBe(1);
    expect(a.ciroTutar.toplam).toBe(1500);
    // (b) çağıran reçetesiyle (K2 süzgeci + `tryDisiMi` — TEK tanım, sipariş düzeyinde).
    const iptalsiz = x.filter(o => o.status !== 'Cancelled');
    const b = brutMarjHesabi(iptalsiz.filter(o => !tryDisiMi(o)), cozucu);
    expect(hamMarj(b)).toBeCloseTo((500 / 1500) * 100, 9);
    expect(iptalsiz.filter(tryDisiMi).length).toBe(1);
  });

  it('5 · yapısal girdi (`Pick` biçimi, düz nesne) kabul edilir; donuk girdi mutasyona uğramaz', () => {
    const duz = Object.freeze({ brutKar: 500, ciroTutar: Object.freeze({ toplam: 1500, bilinen: 1, bilinmeyen: 0 }) });
    expect(hamMarj(duz)).toBe((500 / 1500) * 100);
    expect(hamMarj({ brutKar: 500, ciroTutar: { toplam: 1500, bilinen: 1, bilinmeyen: 1 } })).toBeNull();
    expect(hamMarj({ brutKar: NaN, ciroTutar: { toplam: 1500, bilinen: 1, bilinmeyen: 0 } })).toBeNull();
    expect(hamMarj({ brutKar: 0, ciroTutar: { toplam: 0, bilinen: 0, bilinmeyen: 0 } })).toBeNull();
    // 6c inceleme 1: negatif ciro (iade) — `brutKar / ciro` burada «%20 kâr» üretirdi; kapı `ciroTam > 0`, `!== 0` DEĞİL.
    expect(hamMarj({ brutKar: -200, ciroTutar: { toplam: -1000, bilinen: 1, bilinmeyen: 0 } })).toBeNull();
    expect(duz.ciroTutar.toplam).toBe(1500);
  });
});
