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
import { brutMarjHesabi, stokMaliyetCozucu, stokDevirGunu, type MarjSiparisi } from './raporMarj';
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
