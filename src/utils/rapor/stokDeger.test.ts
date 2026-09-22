/**
 * stokDeger.test.ts — rapor ekranlarının GRUP BAZLI stok adedi/değeri sözleşmesi
 * (Faz 3 6/n · 6a). ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * Sayfadaki sahte kesinlik siteleri (src/components/reports/useReportsData.ts, 2026-09-19 ölçümü):
 *   204 `acc[category] = (acc[category] || 0) + item.stockLevel` → stoğu BİLİNMEYEN tek kart
 *       TÜM kategoriyi NaN yapıyor (korumasız `+=`); "bilinmiyor" sayacı hiç yok.
 *   233 `s + (i.stockLevel * itemPriceTRY(i, 'Retail', exchangeRates))` → `itemPriceTRY`
 *       çevrilemeyen karta ₺0 döndüğü için kalem toplamdan SESSİZCE düşüyor (sayaç yok).
 *   238 `acc[cat].count += item.stockLevel` → aynı korumasız `+=`.
 *   239 `acc[cat].value += item.stockLevel * itemPriceTRY(...)` → aynı sessiz ₺0.
 *   203 `item.category || currentT.other` ↔ 236 `item.category || 'Diğer'` → AYNI kartlar için
 *       iki ayrı boş-kategori etiketi (adet tablosunda "Other", değer tablosunda "Diğer").
 *
 * Kural (CLAUDE.md): bilinmeyen sayı 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR.
 * PARİTE: girdiler biliniyorsa sayı eskiyle birebir aynı (test 1 eski `reduce`ları yeniden kurar).
 */
import { describe, it, expect } from 'vitest';
import { grupStokDegeri, kartPerakendeDegeri } from './stokDeger';
import { degerToplami, type StokKalemi } from '../pano/stokSevkiyat';
import { toplaBilinen, tutarBirlestir } from '../para';
import { kartSatisTL } from '../cost';
import type { InventoryItem } from '../../types';

/** Test kartı — `StokKalemi` yapısal tipi + gruplanacak `category` alanı. */
interface TestKart extends StokKalemi {
  ad?: string;
  category?: unknown;
}

const kart = (category: unknown, stockLevel: unknown, fiyat: unknown, ad = 'ÇİMENTO 50KG'): TestKart =>
  ({ ad, category, stockLevel, prices: { Retail: fiyat } });

/** 6a çağrısının birim değeri: perakende SATIŞ fiyatı (maliyet DEĞİL — K8 → 6h). */
const perakende = (k: TestKart): unknown => k.prices?.['Retail'];
const kategori = (k: TestKart): unknown => k.category;

describe('grupStokDegeri — parite', () => {
  const envanter: TestKart[] = [
    kart('Boya', 10, 5, 'SİLİKONLU CEPHE BOYASI'),
    kart('Boya', 2, 10, 'ASTAR BOYA'),
    kart('Çimento', 1, 100, 'ÇİMENTO 50KG'),
  ];

  it('1 · grup adedi + değeri bugünkü iki `reduce` ile BİREBİR', () => {
    const r = grupStokDegeri(envanter, kategori, perakende);

    expect(r.gruplar.map(g => g.anahtar)).toEqual(['Boya', 'Çimento']);   // sıra = ilk görülme

    const boya = r.gruplar[0];
    expect(boya.kart).toBe(2);
    expect(boya.adet.toplam).toBe(12);
    expect(boya.deger.toplam).toBe(70);        // 10×5 + 2×10

    const cimento = r.gruplar[1];
    expect(cimento.kart).toBe(1);
    expect(cimento.adet.toplam).toBe(1);
    expect(cimento.deger.toplam).toBe(100);

    expect(r.toplamAdet.toplam).toBe(13);
    expect(r.toplamDeger.toplam).toBe(170);

    // Eski kodun ta kendisi (useReportsData:202-206 ve :235-241) — bilinen girdide aynı sayı.
    const eskiAdet = envanter.reduce<Record<string, number>>((acc, i) => {
      const c = String(i.category);
      acc[c] = (acc[c] || 0) + Number(i.stockLevel);
      return acc;
    }, {});
    const eskiDeger = envanter.reduce<Record<string, number>>((acc, i) => {
      const c = String(i.category);
      acc[c] = (acc[c] || 0) + Number(i.stockLevel) * Number(i.prices?.['Retail']);
      return acc;
    }, {});
    expect(Object.fromEntries(r.gruplar.map(g => [g.anahtar, g.adet.toplam]))).toEqual(eskiAdet);
    expect(Object.fromEntries(r.gruplar.map(g => [g.anahtar, g.deger.toplam]))).toEqual(eskiDeger);
  });
});

describe('grupStokDegeri — bilinmeyen 0 SAYILMAZ', () => {
  it('2 · stoğu bilinmeyen kart TÜM kategoriyi NaN yapmaz, sayılır', () => {
    const envanter: TestKart[] = [
      kart('Boya', 10, 5),
      kart('Boya', 2, 10),
      kart('Boya', undefined, 7),          // stok girilmemiş
    ];
    const r = grupStokDegeri(envanter, kategori, perakende);

    // Mutasyon-ayırt-edici: korumasız `+=` (eski :204) burada NaN üretiyordu.
    expect(r.gruplar[0].adet).toEqual({ toplam: 12, bilinen: 2, bilinmeyen: 1 });
    expect(r.gruplar[0].kart).toBe(3);               // kart sayısı düşmez — kayıt var, sayısı yok
    expect(r.toplamAdet).toEqual({ toplam: 12, bilinen: 2, bilinmeyen: 1 });
  });

  it('3 · birim değeri bilinmeyen kart SESSİZCE düşmez, sayılır', () => {
    const envanter: TestKart[] = [
      kart('Boya', 10, 5),
      kart('Boya', 4, undefined),          // fiyat girilmemiş (eski kod: itemPriceTRY → ₺0)
    ];
    const r = grupStokDegeri(envanter, kategori, perakende);

    // Mutasyon-ayırt-edici: `?? 0` toplamı AYNI bırakır (0 eklenir) ama sayacı yanlışlar.
    expect(r.gruplar[0].deger).toEqual({ toplam: 50, bilinen: 1, bilinmeyen: 1 });
    expect(r.gruplar[0].adet.toplam).toBe(14);       // adet tarafı etkilenmez
    expect(r.toplamDeger.bilinmeyen).toBe(1);
  });

  it('4 · BİLİNEN 0 stok istisnası: değer gerçek 0, fiyat aranmaz', () => {
    const envanter: TestKart[] = [kart('Boya', 0, undefined)];
    const r = grupStokDegeri(envanter, kategori, perakende);

    expect(r.gruplar[0].deger).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
    // Kural ikinci kez YAZILMADI: `degerToplami` ile birebir aynı.
    expect(r.toplamDeger).toEqual(degerToplami(envanter, perakende));
  });
});

describe('grupStokDegeri — anahtar normalleştirme', () => {
  it('5 · boş kategori TEK kova (anahtar null) — iki ayrı "Diğer"/"Other" kovası YOK', () => {
    const envanter: TestKart[] = [
      kart('', 5, 10),
      kart('   ', 3, 10),
      kart(undefined, 2, 10),
    ];
    const r = grupStokDegeri(envanter, kategori, perakende);

    expect(r.gruplar.length).toBe(1);
    expect(r.gruplar[0].anahtar).toBeNull();
    expect(r.gruplar[0].kart).toBe(3);
    expect(r.gruplar[0].adet.toplam).toBe(10);
  });

  it('6 · trim: "Boya " ile "Boya" TEK grup', () => {
    const r = grupStokDegeri([kart('Boya ', 1, 10), kart('Boya', 2, 10)], kategori, perakende);
    expect(r.gruplar.length).toBe(1);
    expect(r.gruplar[0].anahtar).toBe('Boya');
    expect(r.gruplar[0].adet.toplam).toBe(3);
  });

  it('8 · boş envanter → grup yok, toplamlar GERÇEK 0', () => {
    const r = grupStokDegeri([], kategori, perakende);
    expect(r.gruplar).toEqual([]);
    expect(r.toplamAdet).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(r.toplamDeger).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('grupStokDegeri — DEĞİŞMEZLER', () => {
  const karisik: TestKart[] = [
    kart('Boya', 10, 5),
    kart('', 3, 10),
    kart('Çimento', 0, undefined),         // bilinen 0 stok
    kart('Boya ', undefined, 7),           // stoğu bilinmeyen + trim'li anahtar
    kart('   ', 2, undefined),             // boş anahtar + fiyatı bilinmeyen
    kart('Diğer', 4, 25),
    kart('Diğer ', 1, 25),
  ];

  it('7 · grupların birleşimi ≡ toplam ≡ `degerToplami`/`toplaBilinen` (üç alan da)', () => {
    const r = grupStokDegeri(karisik, kategori, perakende);

    expect(tutarBirlestir(...r.gruplar.map(g => g.deger))).toEqual(r.toplamDeger);
    expect(r.toplamDeger).toEqual(degerToplami(karisik, perakende));

    expect(tutarBirlestir(...r.gruplar.map(g => g.adet))).toEqual(r.toplamAdet);
    expect(r.toplamAdet).toEqual(toplaBilinen(karisik, k => k.stockLevel));
  });

  it('11 · anahtar BENZERSİZ ve hiçbir kart kaybolmaz/iki gruba girmez', () => {
    const r = grupStokDegeri(karisik, kategori, perakende);

    expect(new Set(r.gruplar.map(g => g.anahtar)).size).toBe(r.gruplar.length);
    expect(r.gruplar.reduce((s, g) => s + g.kart, 0)).toBe(karisik.length);
    expect(r.gruplar.map(g => g.anahtar)).toEqual(['Boya', null, 'Çimento', 'Diğer']);
  });
});

describe('grupStokDegeri — dövizli kart (kartSatisTL)', () => {
  const urun = (o: Partial<InventoryItem>): InventoryItem =>
    ({ id: 'x', sku: 'S', name: 'ÇİMENTO 50KG', ...o }) as InventoryItem;

  const dovizli: InventoryItem[] = [
    urun({ category: 'Boya', stockLevel: 2, prices: { Retail: 100 } }),                             // ₺
    urun({ category: 'Boya', stockLevel: 3, prices: { Retail: 10 }, priceCurrency: 'USD' }),        // $
  ];
  const kat = (k: InventoryItem): unknown => k.category;

  it('9 · kur VARSA TL karşılığı toplanır', () => {
    const r = grupStokDegeri(dovizli, kat, k => kartSatisTL(k, 'Retail', { USD: 40 }));
    expect(r.gruplar[0].deger).toEqual({ toplam: 1400, bilinen: 2, bilinmeyen: 0 });   // 2×100 + 3×400
  });

  it('9b · kur YOKSA ₺0 sayılmaz — bilinmeyen sayacına düşer (uydurma kur yok)', () => {
    const r = grupStokDegeri(dovizli, kat, k => kartSatisTL(k, 'Retail', null));
    expect(r.gruplar[0].deger).toEqual({ toplam: 200, bilinen: 1, bilinmeyen: 1 });
    expect(r.gruplar[0].deger.toplam).not.toBe(230);   // eski `itemPriceTRY` 3×10 = ₺30 ekliyordu
  });
});

describe('grupStokDegeri — ETİKET ÇARPIŞMASI (çağıranın sorumluluğu)', () => {
  const envanter: TestKart[] = [
    kart('Diğer', 5, 10),            // GERÇEK "Diğer" kategorisi
    kart('', 3, 10),                 // boş
    kart(undefined, 2, 10),          // boş
    kart('ÇİMENTO 50KG', 1, 100),
  ];

  it('10 · etiketi `grupSec` İÇİNDE uygulayan çağıran TEK "Diğer" grubu alır', () => {
    const etiketli = (k: TestKart): unknown =>
      (typeof k.category === 'string' && k.category.trim() !== '') ? k.category.trim() : 'Diğer';
    const r = grupStokDegeri(envanter, etiketli, perakende);

    // Mutasyon-ayırt-edici: yardımcı `grupSec` çıktısına bakmadan boş kategoriyi KENDİ
    // `null` kovasına atarsa burada 3 grup çıkar (kırmızı).
    expect(r.gruplar.length).toBe(2);
    const diger = r.gruplar.find(g => g.anahtar === 'Diğer');
    expect(diger?.kart).toBe(3);
    expect(diger?.adet.toplam).toBe(10);
    expect(diger?.deger.toplam).toBe(100);

    // Hiçbir grup `Object.fromEntries` ile SESSİZCE ezilmiyor (pastada iki "Diğer" dilimi yok).
    expect(Object.keys(Object.fromEntries(r.gruplar.map(g => [g.anahtar, g]))).length).toBe(r.gruplar.length);
  });

  it('10b · KARŞI VAKA: etiketi SONRADAN basan çağıran iki "Diğer" üretirdi', () => {
    const r = grupStokDegeri(envanter, kategori, perakende);
    expect(r.gruplar.map(g => g.anahtar)).toEqual(['Diğer', null, 'ÇİMENTO 50KG']);
    expect(r.gruplar[0].kart).toBe(1);      // gerçek kategori
    expect(r.gruplar[1].kart).toBe(2);      // boş kova — etiket sonradan basılsa 'Diğer' ile çarpışır
  });
});

/**
 * kartPerakendeDegeri — Faz 3 6a düzeltme turu (2026-09-22).
 *
 * ARIZA (EnvanterRapor "Depo Özeti" tablosu, AYNI SATIRDA iki sözleşme): Stok ve Durum
 * hücreleri bu turda "karar verilemiyorsa BİLİNMİYOR" kuralına geçirilmişken yanlarındaki
 * Değer hücresi `item.stockLevel * (item.prices?.['Retail'] || 0)` ile kaldı. Fiyatı olmayan
 * kart (Mikro'da yalnız bayi/B2B kademesi tanımlıysa `Retail` HİÇ yoktur — bkz.
 * `server/mikro/eslemeStok.ts`) "₺0" yazıyordu: 120 adetlik ÇİMENTO 50KG "değeri sıfır" diye
 * okunuyor ve stok değeri sıralamasında en alta düşüyordu. Klasik "null × miktar === 0" tuzağı.
 *
 * PARİTE: fiyat ve stok biliniyorsa sayı eskiyle BİREBİR (çarpımın kendisi değişmedi).
 * BİLİNÇLİ FARK: bilinmeyen artık NaN — ekran '—' basar, '₺0' DEĞİL.
 */
describe('kartPerakendeDegeri — "null × miktar === 0" tuzağı', () => {
  it('MUTASYON AYIRT EDİCİ: Retail fiyatı YOKSA değer BİLİNMEZ, ₺0 DEĞİL', () => {
    // Mikro'dan gelen bayi kademeli kart: Retail yok, stok biliniyor.
    const k: TestKart = { ad: 'ÇİMENTO 50KG', stockLevel: 120, prices: { Dealer: 210 } };
    expect(Number.isNaN(kartPerakendeDegeri(k))).toBe(true);
    // `|| 0` geri konursa bu satır 0 döner ve test kırmızıya düşer.
    expect(kartPerakendeDegeri(k)).not.toBe(0);
  });

  it('PARİTE: fiyat ve stok biliniyorsa eski çarpımla birebir', () => {
    expect(kartPerakendeDegeri({ stockLevel: 120, prices: { Retail: 175.5 } })).toBe(120 * 175.5);
    // Tek fiyatlı kart: `price` yedeği (tablo hücresinin `?? item.price` zinciri).
    expect(kartPerakendeDegeri({ stockLevel: 4, price: 25 })).toBe(100);
    // `prices.Retail` varsa `price` OKUNMAZ.
    expect(kartPerakendeDegeri({ stockLevel: 2, price: 999, prices: { Retail: 10 } })).toBe(20);
  });

  it('MEŞRU SIFIR korunur: 0 stok ya da 0 fiyat gerçek ₺0 (bilinmiyor DEĞİL)', () => {
    expect(kartPerakendeDegeri({ stockLevel: 0, prices: { Retail: 175.5 } })).toBe(0);
    expect(kartPerakendeDegeri({ stockLevel: 120, prices: { Retail: 0 } })).toBe(0);
  });

  it('stok okunamıyorsa BİLİNMEZ; NEGATİF stok (veri hatası) gizlenmez', () => {
    expect(Number.isNaN(kartPerakendeDegeri({ stockLevel: null, prices: { Retail: 10 } }))).toBe(true);
    expect(Number.isNaN(kartPerakendeDegeri({ stockLevel: 'okunamadı', prices: { Retail: 10 } }))).toBe(true);
    expect(kartPerakendeDegeri({ stockLevel: -12, prices: { Retail: 10 } })).toBe(-120);
  });

  it('eski `stock` alanı yedeği `stokSeviyesi` ile AYNI (satırın diğer hücreleriyle ayrışmaz)', () => {
    expect(kartPerakendeDegeri({ stock: 30, prices: { Retail: 10 } })).toBe(300);
    expect(kartPerakendeDegeri({ stockLevel: 5, stock: 30, prices: { Retail: 10 } })).toBe(50);
  });
});
