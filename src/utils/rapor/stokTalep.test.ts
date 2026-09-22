/**
 * stokTalep.test.ts — ÖNCE YAZILDI (Faz 3 6a, 2026-09-19). Kırmızı görülüp sonra modül yazıldı.
 *
 * Sınanan sözleşme: ürün talebi → günlük talep → kalan gün → öneri adedi. İki panelin
 * (`GenelOzet.tsx:398-450` P148 "Stok Tükenme Tahmini", `RaporlarPage.tsx:718-765` P619
 * "Akıllı Sipariş Önerisi") AYNI ürün için farklı sayı üretmesinin kaynağı olan dört kural
 * burada kilitlenir: eşleme, miktar, stok, pencere.
 *
 * `gunlukTalep` ve `kalanGun` MODÜL İÇİDİR (6a'da dış tüketicisi yok — JIT). Sözleşmeleri
 * `tukenmeSatirlari` üzerinden sınanır (vaka 2, 3, 8, 9, 10).
 */
import { describe, it, expect } from 'vitest';
import {
  talepKartCozucu,
  urunTalebi,
  tukenmeSatirlari,
  tukenmeListesi,
  oneriAdedi,
  type TalepSiparisi,
  type UrunTalebi,
} from './stokTalep';

/** Fikstür saati — pencere sınırları buna göre. 30 g penceresi 2026-08-20T09:00Z'de başlar. */
const SIMDI = new Date('2026-09-19T09:00:00Z');

/** Şirin İnşaat'ın kataloğu (₺, inşaat malzemesi). */
const CIMENTO = { id: 'k1', sku: 'CIM50', name: 'ÇİMENTO 50KG', stockLevel: 60 };
const DEMIR = { id: 'k2', sku: 'DMR12', name: 'İNŞAAT DEMİRİ 12MM', stockLevel: 12 };
const KATALOG = [CIMENTO, DEMIR];

/** `!` yerine: fikstürde pencere geçerli olmalı — değilse testin kendisi bozuktur. */
function talepGerek<K>(t: UrunTalebi<K> | null): UrunTalebi<K> {
  if (t === null) throw new Error('urunTalebi null döndü — fikstürde pencereGun geçerli olmalı');
  return t;
}

/** Fikstür kartı: hem eşleşme (`id`/`sku`/`name`) hem stok (`stockLevel`/eski `stock`) alanları. */
type TalepKart = { id?: unknown; sku?: unknown; name?: unknown; stockLevel?: unknown; stock?: unknown };

function talep(
  siparisler: readonly TalepSiparisi[],
  kartlar: readonly TalepKart[] = KATALOG,
  pencereGun = 30,
): UrunTalebi<TalepKart> | null {
  return urunTalebi(siparisler, { pencereGun, simdi: SIMDI, kartSec: talepKartCozucu(kartlar) });
}

// ── 1. PARİTE (P619) ────────────────────────────────────────────────────────────────────────

describe('parite — eski P619 sayısı birebir', () => {
  it('30 g / stok 60 / satış 10+20 → günlük 1, kalan 60, öneri 60 adet', () => {
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 10 }] },
      { status: 'Shipped', createdAt: '2026-09-15T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 20 }] },
    ]));

    expect(t.talep.get(CIMENTO)).toEqual({ toplam: 30, bilinen: 2, bilinmeyen: 0 });
    expect(t.penceredeSiparis).toBe(2);
    expect(t.eslesmeyenKalem).toBe(0);

    const satirlar = tukenmeSatirlari(t, 30);
    expect(satirlar).toHaveLength(1);           // talebi olmayan DEMİR satır üretmez
    expect(satirlar[0].kart).toBe(CIMENTO);
    expect(satirlar[0].stok).toBe(60);
    expect(satirlar[0].gunluk).toBe(1);         // eski: sold / p619MinCoverage = 30/30
    expect(satirlar[0].kalan).toBe(60);         // eski: floor(stockLevel / avgDailyDemand)
    expect(satirlar[0].neden).toBeNull();

    // eski: ceil(avgDailyDemand * p619MinCoverage * 2)
    expect(oneriAdedi(satirlar[0].gunluk, 30, 2)).toBe(60);
  });

  it('iptal edilen sipariş pencereye girmez (iki panelle parite)', () => {
    const t = talepGerek(talep([
      { status: 'Cancelled', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 999 }] },
    ]));
    expect(t.penceredeSiparis).toBe(0);
    expect(t.talep.size).toBe(0);
    expect(tukenmeSatirlari(t, 30)).toHaveLength(0);
  });

  it('pencere dışı (31 gün önce) sipariş sayılmaz', () => {
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-08-18T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 40 }] },
    ]));
    expect(t.penceredeSiparis).toBe(0);
    expect(t.talep.size).toBe(0);
  });
});

// ── 2. STOK BİLİNMİYOR ≠ 0 GÜN ──────────────────────────────────────────────────────────────

describe('stok bilinmiyorsa "0 gün kaldı" ÜRETİLMEZ', () => {
  it('MUTASYON-AYIRT EDİCİ — stockLevel yok → kalan null, neden "stok-bilinmiyor"', () => {
    const stoksuzKart = { id: 'k9', sku: 'TUGLA', name: 'TUĞLA 19CM' };  // stockLevel HİÇ YOK
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'TUGLA', quantity: 30 }] },
    ], [stoksuzKart]));

    const [satir] = tukenmeSatirlari(t, 30);
    expect(satir.stok).toBeNaN();
    expect(satir.gunluk).toBe(1);
    expect(satir.kalan).toBeNull();
    expect(satir.neden).toBe('stok-bilinmiyor');
    // P619'un `item.stockLevel || 0` kuralı burada KIRMIZI "0 gün kaldı" kartı + satın alma önerisi basıyordu:
    expect(satir.kalan).not.toBe(0);
  });

  it('stok kapısı talep kapısından ÖNCE gelir (ikisi de bilinmiyorken neden "stok-bilinmiyor")', () => {
    const stoksuzKart = { id: 'k9', sku: 'TUGLA', name: 'TUĞLA 19CM' };
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'TUGLA', quantity: null }] },
    ], [stoksuzKart]));
    expect(tukenmeSatirlari(t, 30)[0].neden).toBe('stok-bilinmiyor');
  });
});

// ── 3. MİKTAR BİLİNMİYOR → TÜRETME YOK ──────────────────────────────────────────────────────

describe('miktarı bilinmeyen kalem — kısmi çıkıştan gün ÜRETİLMEZ', () => {
  it('MUTASYON-AYIRT EDİCİ — 10 + bilinmeyen → satılan {10,1,1}, günlük null', () => {
    const t = talepGerek(talep([
      {
        status: 'Delivered',
        createdAt: '2026-09-10T08:00:00Z',
        lineItems: [{ sku: 'CIM50', quantity: 10 }, { sku: 'CIM50', quantity: undefined }],
      },
    ]));

    expect(t.talep.get(CIMENTO)).toEqual({ toplam: 10, bilinen: 1, bilinmeyen: 1 });

    const [satir] = tukenmeSatirlari(t, 30);
    expect(satir.satilan).toEqual({ toplam: 10, bilinen: 1, bilinmeyen: 1 });
    expect(satir.gunluk).toBeNull();
    expect(satir.kalan).toBeNull();
    expect(satir.neden).toBe('talep-bilinmiyor');
    // `ekranTutari` (kısmi toplam) ile bölmek 10/30 = 0,333 → "180 gün kaldı" derdi (GEÇ uyarı):
    expect(satir.gunluk).not.toBeCloseTo(10 / 30, 6);
  });

  it("miktarı 'abc' olan kalem de bilinmeyendir (null × miktar = 0 tuzağı yok)", () => {
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 'abc' }] },
    ]));
    expect(t.talep.get(CIMENTO)).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(tukenmeSatirlari(t, 30)[0].neden).toBe('talep-bilinmiyor');
  });
});

// ── 4. TÜM KALEMLER SAYILIR (P148 `find` kuralı düştü) ──────────────────────────────────────

describe('sipariş başına TÜM eşleşen kalemler sayılır', () => {
  it('MUTASYON-AYIRT EDİCİ — aynı siparişte ÇİMENTO × 2 iki satır → 4 (P148 `find` 2 veriyordu)', () => {
    const t = talepGerek(talep([
      {
        status: 'Delivered',
        createdAt: '2026-09-12T08:00:00Z',
        lineItems: [{ sku: 'CIM50', quantity: 2 }, { sku: 'CIM50', quantity: 2 }],
      },
    ]));
    expect(t.talep.get(CIMENTO)).toEqual({ toplam: 4, bilinen: 2, bilinmeyen: 0 });
  });
});

// ── 5. EŞLEME ZİNCİRİ ───────────────────────────────────────────────────────────────────────

describe('talepKartCozucu — kimlik/sku → kimlik/ad, BOŞ ANAHTAR EŞLEŞMEZ', () => {
  const coz = talepKartCozucu(KATALOG);

  it('sku ile eşleşir', () => expect(coz({ sku: 'CIM50' })).toBe(CIMENTO));
  it('kimlik (inventoryId) ile eşleşir', () => expect(coz({ inventoryId: 'k1' })).toBe(CIMENTO));
  it('sku/kimlik yoksa AD ile eşleşir (P148 kuralı zincire alındı)', () => {
    expect(coz({ name: 'İNŞAAT DEMİRİ 12MM' })).toBe(DEMIR);
  });

  it('MUTASYON-AYIRT EDİCİ — boş sku/ad katalogdaki boş anahtarlı karta BAĞLANMAZ', () => {
    const bozukKatalog = [{ id: '', sku: '', name: '', stockLevel: 999 }, ...KATALOG];
    const bozukCoz = talepKartCozucu(bozukKatalog);
    expect(bozukCoz({ sku: '', name: '' })).toBeNull();
    expect(bozukCoz({})).toBeNull();
    expect(bozukCoz({ sku: '   ', name: '  ' })).toBeNull();
  });

  it('eşleşmeyen kalem SAYILIR (sessizce düşmez)', () => {
    const t = talepGerek(talep([
      {
        status: 'Delivered',
        createdAt: '2026-09-12T08:00:00Z',
        lineItems: [{ sku: 'CIM50', quantity: 5 }, { name: 'Nakliye bedeli', quantity: 1 }],
      },
    ]));
    expect(t.eslesmeyenKalem).toBe(1);
    expect(t.talep.get(CIMENTO)).toEqual({ toplam: 5, bilinen: 1, bilinmeyen: 0 });
  });
});

// ── 6. KALEMSİZ SİPARİŞ ─────────────────────────────────────────────────────────────────────

describe('kalemsiz (Mikro sözde-)sipariş talebi BESLEMEZ ama SAYILIR', () => {
  it('lineItems yok → kalemsizSiparis 1, talep değişmez', () => {
    const mikroSiparisi = { status: 'Delivered', createdAt: '2026-09-12T08:00:00Z', source: 'mikro-fatura' };
    const t = talepGerek(talep([
      mikroSiparisi,
      { status: 'Delivered', createdAt: '2026-09-12T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 3 }] },
    ]));
    expect(t.kalemsizSiparis).toBe(1);
    expect(t.penceredeSiparis).toBe(2);
    expect(t.talep.get(CIMENTO)).toEqual({ toplam: 3, bilinen: 1, bilinmeyen: 0 });
  });

  it('lineItems boş dizi de kalemsizdir', () => {
    const t = talepGerek(talep([{ status: 'Delivered', createdAt: '2026-09-12T08:00:00Z', lineItems: [] }]));
    expect(t.kalemsizSiparis).toBe(1);
    expect(t.talep.size).toBe(0);
  });
});

// ── 7. TARİHSİZ ─────────────────────────────────────────────────────────────────────────────

describe('tarihi çözülemeyen sipariş', () => {
  it('tarihsiz sayılır, pencereye GİRMEZ', () => {
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: 'çözülemez', lineItems: [{ sku: 'CIM50', quantity: 9 }] },
    ]));
    expect(t.tarihsiz).toBe(1);
    expect(t.penceredeSiparis).toBe(0);
    expect(t.talep.size).toBe(0);
  });

  it('iptal sipariş ne pencereye ne tarihsize girer', () => {
    const t = talepGerek(talep([{ status: 'Cancelled', createdAt: null, lineItems: [] }]));
    expect(t.tarihsiz).toBe(0);
    expect(t.penceredeSiparis).toBe(0);
  });

  it('BİLİNÇLİ FARK — createdAt yoksa syncedAt okunur (iki panel bu kaydı sessizce düşürüyordu)', () => {
    const t = talepGerek(talep([
      { status: 'Delivered', syncedAt: '2026-09-12T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 7 }] },
    ]));
    expect(t.tarihsiz).toBe(0);
    expect(t.penceredeSiparis).toBe(1);
    expect(t.talep.get(CIMENTO)).toEqual({ toplam: 7, bilinen: 1, bilinmeyen: 0 });
  });
});

// ── 8. PENCERE GEÇERSİZ ─────────────────────────────────────────────────────────────────────

describe('pencereGun geçersizse hesap YAPILMAZ', () => {
  const siparisler: readonly TalepSiparisi[] = [
    { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 30 }] },
  ];

  it('MUTASYON-AYIRT EDİCİ — 0 / NaN / -3 → null (Infinity ya da "NaN adet" yok)', () => {
    expect(talep(siparisler, KATALOG, 0)).toBeNull();
    expect(talep(siparisler, KATALOG, Number.NaN)).toBeNull();
    expect(talep(siparisler, KATALOG, -3)).toBeNull();
    expect(talep(siparisler, KATALOG, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('simdi geçersiz Date ise de null (sessiz pencere düşmesi yok)', () => {
    expect(urunTalebi(siparisler, {
      pencereGun: 30,
      simdi: new Date('geçersiz'),
      kartSec: talepKartCozucu(KATALOG),
    })).toBeNull();
  });

  it('tukenmeSatirlari geçersiz pencereyle sayı UYDURMAZ', () => {
    const t = talepGerek(talep(siparisler));
    const [satir] = tukenmeSatirlari(t, 0);
    expect(satir.gunluk).toBeNull();
    expect(satir.kalan).toBeNull();
    expect(satir.neden).toBe('talep-bilinmiyor');
  });

  it('oneriAdedi — girdilerden biri bilinmiyor / ≤ 0 → null', () => {
    expect(oneriAdedi(1, null, 2)).toBeNull();
    expect(oneriAdedi(null, 30, 2)).toBeNull();
    expect(oneriAdedi(1, 0, 2)).toBeNull();
    expect(oneriAdedi(0, 30, 2)).toBeNull();
    expect(oneriAdedi(1, 30, 0)).toBeNull();
    expect(oneriAdedi(Number.NaN, 30, 2)).toBeNull();
    expect(oneriAdedi(1, Number.POSITIVE_INFINITY, 2)).toBeNull();
  });

  it('oneriAdedi kesirli günlük talebi YUKARI yuvarlar (eski ceil paritesi)', () => {
    expect(oneriAdedi(0.5, 45, 2)).toBe(45);
    expect(oneriAdedi(1 / 3, 30, 2)).toBe(20);
  });
});

// ── 9. TALEP YOK ────────────────────────────────────────────────────────────────────────────

describe('talep yok — 999 / Infinity nöbet değeri YOK', () => {
  it('Map\'te olmayan kart satır ÜRETMEZ', () => {
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 5 }] },
    ]));
    const satirlar = tukenmeSatirlari(t, 30);
    expect(satirlar.map(s => s.kart)).toEqual([CIMENTO]);   // DEMİR yok
  });

  it('MUTASYON-AYIRT EDİCİ — bilinen sıfır çıkış → günlük 0, kalan null, neden "talep-yok"', () => {
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 0 }] },
    ]));
    const [satir] = tukenmeSatirlari(t, 30);
    expect(satir.gunluk).toBe(0);
    expect(satir.kalan).toBeNull();
    expect(satir.neden).toBe('talep-yok');
    expect(satir.kalan).not.toBe(999);
    expect(satir.kalan).not.toBe(Number.POSITIVE_INFINITY);
  });
});

// ── 10. GERÇEK TÜKENME (bilinen sıfır) ──────────────────────────────────────────────────────

describe('stok BİLİNEN sıfır/negatif + talep var → kalan 0', () => {
  it('stockLevel 0 → kalan 0, neden null', () => {
    const bitmisKart = { id: 'k3', sku: 'KUM', name: 'DERE KUMU', stockLevel: 0 };
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'KUM', quantity: 60 }] },
    ], [bitmisKart]));
    const [satir] = tukenmeSatirlari(t, 30);
    expect(satir.gunluk).toBe(2);
    expect(satir.kalan).toBe(0);
    expect(satir.neden).toBeNull();
  });

  it('stockLevel -3 (sayım hatası) → kalan 0, negatif gün üretilmez', () => {
    const eksiKart = { id: 'k4', sku: 'KUM', name: 'DERE KUMU', stockLevel: -3 };
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'KUM', quantity: 60 }] },
    ], [eksiKart]));
    expect(tukenmeSatirlari(t, 30)[0].kalan).toBe(0);
  });
});

// ── 11. HAM GÜN (yuvarlama çağıranda) ───────────────────────────────────────────────────────

describe('kalan gün HAM döner — yuvarlamayı çağıran yapar (P148 round / P619 floor)', () => {
  it('stok 10 / günlük 3 → 3,333 (ne 3 ne 4)', () => {
    const kart = { id: 'k5', sku: 'ALCI', name: 'ALÇI 25KG', stockLevel: 10 };
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'ALCI', quantity: 90 }] },
    ], [kart]));
    const [satir] = tukenmeSatirlari(t, 30);
    expect(satir.gunluk).toBe(3);
    expect(satir.kalan).toBeCloseTo(10 / 3, 10);
    expect(Math.round(satir.kalan ?? Number.NaN)).toBe(3);   // P148
    expect(Math.floor(satir.kalan ?? Number.NaN)).toBe(3);   // P619
  });
});

// ── 12. ESKİ `stock` ALANI ──────────────────────────────────────────────────────────────────

describe('stok alanı zinciri (finansKpi.stokSeviyesi)', () => {
  it('stockLevel yoksa eski `stock` okunur', () => {
    const eskiKart = { id: 'k6', sku: 'ALCI', name: 'ALÇI 25KG', stock: 12 };
    const t = talepGerek(talep([
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'ALCI', quantity: 30 }] },
    ], [eskiKart]));
    const [satir] = tukenmeSatirlari(t, 30);
    expect(satir.stok).toBe(12);
    expect(satir.kalan).toBe(12);
    expect(satir.neden).toBeNull();
  });
});

// ── P148 LİSTE KAPISI (aday + ufuk + sayaçlar) ──────────────────────────────────────────────
//
// Bu blok 2026-09-20 hakem turunda EKLENDİ. `tukenmeListesi` o güne kadar GenelOzet.tsx:575-596
// içinde satır içi duruyordu ve hiçbir testle kilitli değildi: hakem, eşiği tanımsız karta
// uydurma 5 varsayılanı geri koyan bir mutasyon (`seviye <= (Number.isFinite(esik) ? esik : 5) * carpan`)
// yazdı ve `npx vitest run src/components/reports` YEŞİL kaldı. Aşağıdaki vakalar o mutasyonu
// ve kardeşlerini (ufuk süzgeci, çift sayım, sıralama, kesme) KIRMIZIYA düşürür.

/** Aday/ufuk/kesme kapısı için kart: eşleşme + stok + EŞİK alanları. */
type ListeKart = {
  id?: unknown; sku?: unknown; name?: unknown;
  stockLevel?: unknown; stock?: unknown; lowStockThreshold?: unknown; minStock?: unknown;
};

/** GenelOzet P148'in adlandırılmış sabitleri (K20 "ok kalsın" — değerler değişmez). */
const AYAR = { carpan: 3, ufukGun: 45, satir: 8 };

// Şirin İnşaat'ın kataloğu — stok/eşik çiftleri aday kapısını AYIRT EDECEK şekilde seçildi.
/** Aday: 12 ≤ 5 × 3. Günlük 1 talep → kalan 12 gün. */
const L_CIMENTO: ListeKart = { id: 'p1', sku: 'CIM50', name: 'ÇİMENTO 50KG', stockLevel: 12, lowStockThreshold: 5 };
/** Aday DEĞİL: 90 > 5 × 3. */
const L_DEMIR: ListeKart = { id: 'p2', sku: 'DMR12', name: 'İNŞAAT DEMİRİ 12MM', stockLevel: 90, lowStockThreshold: 5 };
/** EŞİĞİ TANIMSIZ, stoğu CIMENTO ile AYNI: uydurma 5 eşiği geri gelirse listeye girer. */
const L_ALCI: ListeKart = { id: 'p3', sku: 'ALCI25', name: 'ALÇI 25KG', stockLevel: 12 };
/** Stoğu okunamayan kart (eşiği var) — aday OLAMAZ, sayılır. */
const L_TUGLA: ListeKart = { id: 'p4', sku: 'TGL', name: 'TUĞLA', lowStockThreshold: 5 };

const satis = (sku: string, quantity: unknown) => ({ sku, quantity });
const siparis = (...lineItems: { sku: string; quantity: unknown }[]): TalepSiparisi =>
  ({ status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems });

function listele(
  siparisler: readonly TalepSiparisi[],
  kartlar: readonly ListeKart[],
  ayar: { carpan: number; ufukGun: number; satir: number } = AYAR,
) {
  const t = talepGerek(urunTalebi(siparisler, { pencereGun: 30, simdi: SIMDI, kartSec: talepKartCozucu(kartlar) }));
  return tukenmeListesi(tukenmeSatirlari(t, 30), kartlar, ayar);
}

describe('tukenmeListesi — aday kapısı', () => {
  it('PARİTE — eşiği bilinen, eşiğin ×3 altındaki ürün listeye girer (kalan gün birebir)', () => {
    const r = listele([siparis(satis('CIM50', 30))], [L_CIMENTO, L_DEMIR]);
    expect(r.liste.map(s => s.kart)).toEqual([L_CIMENTO]);
    expect(r.liste[0].kalan).toBe(12);          // eski: stockLevel / (sold / 30)
    expect(r.esiksiz).toBe(0);
    expect(r.miktarsizUrun).toBe(0);
    expect(r.bos).toBe(false);
  });

  it('MUTASYON-AYIRT EDİCİ — eşiği TANIMSIZ ürün listeye GİRMEZ, `esiksiz`de sayılır', () => {
    // Eski satır: `i.stockLevel <= (i.lowStockThreshold ?? 5) * 3` → 12 ≤ 15 → listede.
    // Aynı arızanın `?? 5` grep'ine takılmayan biçimi de budur:
    //   `seviye <= (Number.isFinite(esik) ? esik : 5) * carpan`   ← hakem mutasyonu (2026-09-20)
    // Fikstür bunu ayırt eder: ALÇI'nın stoğu CIMENTO ile AYNI (12), farkı yalnız eşiğin YOKLUĞU.
    expect(12 <= 5 * AYAR.carpan).toBe(true);   // uydurma eşikle listeye GİRERDİ
    const r = listele([siparis(satis('ALCI25', 30))], [L_ALCI]);
    expect(r.liste).toEqual([]);
    expect(r.esiksiz).toBe(1);
    expect(r.bos).toBe(false);                  // liste boş AMA panel not ile görünür
  });

  it('eşiği eşiğin ÜSTÜNDE kalan ürün aday değildir (stok 90 > 5 × 3)', () => {
    const r = listele([siparis(satis('DMR12', 30))], [L_DEMIR]);
    expect(r.liste).toEqual([]);
    expect(r.bos).toBe(true);                   // sayaçların hiçbiri dolmadı → panel çizilmez
  });

  it('`esiksiz` yalnız stoğu BİLİNEN ve POZİTİF kartı sayar (çift not yok)', () => {
    // Stoğu okunamayan kart: `esiksiz`e DEĞİL, `stokBilinmeyen`e girer (eşiği de olsa olmasa da).
    const hic: ListeKart = { id: 'p5', sku: 'HRC', name: 'HARÇ' };
    const r = listele([siparis(satis('HRC', 30))], [hic]);
    expect(r.esiksiz).toBe(0);
    expect(r.stokBilinmeyen).toBe(1);
    // Stoğu BİLİNEN sıfır kart da `esiksiz` değildir (zaten tükenmiş; eşik sorusu anlamsız).
    const bitti: ListeKart = { id: 'p6', sku: 'KRM', name: 'KEREMİT', stockLevel: 0 };
    expect(listele([siparis(satis('KRM', 30))], [bitti]).esiksiz).toBe(0);
  });

  it('eşik zinciri `minStock`e düşer (finansKpi.stokEsigi) — eşiksiz SAYILMAZ', () => {
    const kart: ListeKart = { id: 'p7', sku: 'IZO', name: 'İZOLASYON LEVHASI', stockLevel: 12, minStock: 5 };
    const r = listele([siparis(satis('IZO', 30))], [kart]);
    expect(r.liste.map(s => s.kart)).toEqual([kart]);
    expect(r.esiksiz).toBe(0);
  });
});

describe('tukenmeListesi — ufuk süzgeci, sıralama, kesme', () => {
  /** Günlük 1 talep (30 adet / 30 gün) üreten tek kart; stok = kalan gün. */
  const kart = (id: string, stockLevel: number): ListeKart =>
    ({ id, sku: id, name: `KALEM ${id}`, stockLevel, lowStockThreshold: 20 });

  it('MUTASYON-AYIRT EDİCİ — ufuk yuvarlanmış güne bakar (45,4 İÇERİDE / 45,6 DIŞARIDA)', () => {
    const a = kart('A', 45.4), b = kart('B', 45.6);
    const r = listele([siparis(satis('A', 30), satis('B', 30))], [a, b]);
    expect(r.liste.map(s => s.kart)).toEqual([a]);   // round(45,4)=45 ≤ 45; round(45,6)=46 > 45
    // Ufkun DIŞINDA kalan ürün sayaç ÜRETMEZ: tahmini hesaplandı, yalnız listeye girmedi.
    expect([r.esiksiz, r.stokBilinmeyen, r.talebiBilinmeyenAday]).toEqual([0, 0, 0]);
  });

  it('kalan güne göre ARTAN sıralanır (acil olan başta)', () => {
    const a = kart('A', 12), b = kart('B', 3), c = kart('C', 1);
    const r = listele([siparis(satis('A', 30), satis('B', 30), satis('C', 30))], [a, b, c]);
    expect(r.liste.map(s => s.kart)).toEqual([c, b, a]);
  });

  it('`satir` kadar kesilir (en acil olanlar kalır)', () => {
    const a = kart('A', 12), b = kart('B', 3), c = kart('C', 1);
    const r = listele([siparis(satis('A', 30), satis('B', 30), satis('C', 30))], [a, b, c],
      { ...AYAR, satir: 2 });
    expect(r.liste.map(s => s.kart)).toEqual([c, b]);
  });
});

describe('tukenmeListesi — sayaçlar ÇİFT SAYMAZ', () => {
  it('stoğu okunamayan ürün sayılır; liste boş olsa da panel görünür', () => {
    const r = listele([siparis(satis('TGL', 30))], [L_TUGLA]);
    expect(r.liste).toEqual([]);
    expect(r.stokBilinmeyen).toBe(1);
    expect(r.talebiBilinmeyenAday).toBe(0);
    expect(r.miktarsizUrun).toBe(1);
    expect(r.bos).toBe(false);
  });

  it('MUTASYON-AYIRT EDİCİ — kısmi talep yalnız ADAY üründe sayılır', () => {
    // ÇİMENTO aday (12 ≤ 15) → kısmi çıkıştan gün üretilmez, SAYILIR.
    // DEMİR aday değil (90 > 15) → onun için zaten tahmin beklenmiyor, SAYILMAZ.
    // Aday kapısı sayaçtan düşerse bu sayı 2 olur ve kullanıcı "2 ürün için tahmin yok" okur.
    const r = listele(
      [siparis(satis('CIM50', 10), satis('CIM50', 'abc'), satis('DMR12', 'abc'))],
      [L_CIMENTO, L_DEMIR],
    );
    expect(r.talebiBilinmeyenAday).toBe(1);
    expect(r.miktarsizUrun).toBe(1);
    expect(r.liste).toEqual([]);                // kısmi çıkıştan gün ÜRETİLMEZ
  });

  it('iki sayaç AYRIK — toplam benzersizdir', () => {
    const r = listele(
      [siparis(satis('CIM50', 10), satis('CIM50', 'abc'), satis('TGL', 30))],
      [L_CIMENTO, L_TUGLA],
    );
    expect(r.stokBilinmeyen).toBe(1);
    expect(r.talebiBilinmeyenAday).toBe(1);
    expect(r.miktarsizUrun).toBe(2);
  });

  it('hem stoğu hem talebi okunamayan ürün TEK kez sayılır (stok kapısı önce)', () => {
    const kirec: ListeKart = { id: 'p9', sku: 'KRC', name: 'KİREÇ', lowStockThreshold: 5 };
    const r = listele([siparis(satis('KRC', 10), satis('KRC', 'abc'))], [kirec]);
    expect(r.stokBilinmeyen).toBe(1);
    expect(r.talebiBilinmeyenAday).toBe(0);
    expect(r.miktarsizUrun).toBe(1);            // 2 DEĞİL
  });

  it('`bos` — liste ve her iki sayaç sıfırken panel ÇİZİLMEZ', () => {
    expect(listele([], [L_DEMIR])).toEqual({
      liste: [], esiksiz: 0, stokBilinmeyen: 0, talebiBilinmeyenAday: 0, miktarsizUrun: 0, bos: true,
    });
  });
});

describe('tukenmeListesi — geçersiz ayar sayı UYDURMAZ', () => {
  const tekSiparis = [siparis(satis('CIM50', 30))];

  it('çarpan geçersizse aday ÜRETİLMEZ (uydurma eşik yok)', () => {
    for (const carpan of [NaN, 0, -3, Infinity]) {
      expect(listele(tekSiparis, [L_CIMENTO], { ...AYAR, carpan }).liste, String(carpan)).toEqual([]);
    }
  });

  it('ufuk geçersizse liste BOŞ kalır (süzgeç değerlendirilemez)', () => {
    for (const ufukGun of [NaN, 0, -1]) {
      expect(listele(tekSiparis, [L_CIMENTO], { ...AYAR, ufukGun }).liste, String(ufukGun)).toEqual([]);
    }
  });

  it('satır sayısı geçersizse KESME yapılmaz — veri gizlenmez', () => {
    const r = listele(tekSiparis, [L_CIMENTO], { ...AYAR, satir: NaN });
    expect(r.liste).toHaveLength(1);
  });
});

// ── GİRDİ MUTASYONA UĞRAMAZ ─────────────────────────────────────────────────────────────────

describe('saflık', () => {
  it('tukenmeListesi satır dizisini YERİNDE sıralamaz', () => {
    const a: ListeKart = { id: 'A', sku: 'A', name: 'KALEM A', stockLevel: 12, lowStockThreshold: 20 };
    const b: ListeKart = { id: 'B', sku: 'B', name: 'KALEM B', stockLevel: 1, lowStockThreshold: 20 };
    const t = talepGerek(urunTalebi(
      [siparis(satis('A', 30), satis('B', 30))],
      { pencereGun: 30, simdi: SIMDI, kartSec: talepKartCozucu([a, b]) },
    ));
    const satirlar = tukenmeSatirlari(t, 30);
    const girdiSirasi = satirlar.map(s => s.kart);
    const r = tukenmeListesi(satirlar, [a, b], AYAR);
    expect(r.liste.map(s => s.kart)).toEqual([b, a]);       // çıktı sıralı
    expect(satirlar.map(s => s.kart)).toEqual(girdiSirasi); // girdi DEĞİŞMEDİ
  });

  it('sipariş listesi ve katalog DEĞİŞMEZ', () => {
    const siparisler: readonly TalepSiparisi[] = [
      { status: 'Delivered', createdAt: '2026-09-10T08:00:00Z', lineItems: [{ sku: 'CIM50', quantity: 10 }] },
    ];
    const kopya = JSON.parse(JSON.stringify(siparisler)) as unknown;
    const katalogKopya = JSON.parse(JSON.stringify(KATALOG)) as unknown;
    const t = talepGerek(talep(siparisler));
    tukenmeSatirlari(t, 30);
    expect(JSON.parse(JSON.stringify(siparisler))).toEqual(kopya);
    expect(JSON.parse(JSON.stringify(KATALOG))).toEqual(katalogKopya);
  });
});
