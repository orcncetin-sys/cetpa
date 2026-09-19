/**
 * cost.test.ts — döviz maliyetinin kur yokken NE YAPMADIĞINI sabitler.
 *
 * Kullanıcı kararı (2026-08-26): kur yoksa UYDURMA, "kur bulunamadı" de ve kur
 * gelince kendiliğinden düzelsin; para biriminin türü bilinmiyorsa TL toplamına
 * karıştırma, ayrı N/A olarak göster.
 *
 * Eski hâli `raw * (rates[cur] ?? 1)` idi: $100 maliyet kur yokken ₺100
 * sayılıyordu — maliyet ~40 kat düşük, marj şişkin.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { itemCostTRY, itemPriceTRY, maliyetDurumu, kartMaliyetiTL, kartSatisTL, cevrilemeyenler, cevrilemeyenMesaji, maliyetTarihleri } from './cost';
import { kurArsiviDoldur, kurArsiviTemizle } from './kurArsivi';
import type { InventoryItem } from '../types';

const urun = (o: Partial<InventoryItem>) => ({ id: 'x', name: 'X', sku: 'S', ...o }) as InventoryItem;
const KURLAR = { USD: 40, EUR: 44 };

describe('itemCostTRY', () => {
  it('TL maliyet aynen döner (kur hiç gerekmez)', () => {
    expect(itemCostTRY(urun({ costPrice: 100 }), KURLAR)).toBe(100);              // etiketsiz = TL
    expect(itemCostTRY(urun({ costPrice: 100, costCurrency: 'TRY' }), null)).toBe(100);
  });

  it('kur varsa doğru çevirir', () => {
    expect(itemCostTRY(urun({ costPrice: 100, costCurrency: 'USD' }), KURLAR)).toBe(4000);
    expect(itemCostTRY(urun({ costPrice: 100, costCurrency: 'EUR' }), KURLAR)).toBe(4400);
  });

  it('KUR YOKSA 0 döner — 1:1 saymaz', () => {
    const d = urun({ costPrice: 100, costCurrency: 'USD' });
    expect(itemCostTRY(d, null)).toBe(0);
    expect(itemCostTRY(d, {})).toBe(0);
    expect(itemCostTRY(d, { USD: 0 })).toBe(0);
    expect(itemCostTRY(d, KURLAR)).not.toBe(100);   // eski hatanın ta kendisi
  });

  it('durum sınıflandırması kur-yok / bilinmeyen-birim ayırıyor', () => {
    expect(maliyetDurumu(urun({ costPrice: 100, costCurrency: 'USD' }), null))
      .toEqual({ durum: 'kur-yok', tutar: 100, birim: 'USD' });
    // Tip dışı bir kod (Mikro/eski veri) TL toplamına karışmaz, N/A olur.
    expect(maliyetDurumu(urun({ costPrice: 100, costCurrency: 'GBP' as 'USD' }), KURLAR))
      .toEqual({ durum: 'bilinmeyen-birim', tutar: 100, birim: 'GBP' });
  });
});

describe('itemPriceTRY — fiyat tarafı aynı kural', () => {
  it('kur yoksa 0, varsa çevirir', () => {
    const d = urun({ prices: { Retail: 100 }, priceCurrency: 'USD' } as Partial<InventoryItem>);
    expect(itemPriceTRY(d, 'Retail', KURLAR)).toBe(4000);
    expect(itemPriceTRY(d, 'Retail', null)).toBe(0);
  });
});

describe('cevrilemeyenler — sessiz eksiltmeyi GÖRÜNÜR yapar', () => {
  const liste = [
    urun({ costPrice: 10 }),                                        // TL
    urun({ costPrice: 10, costCurrency: 'USD' }),                   // kur gerekir
    urun({ costPrice: 10, costCurrency: 'EUR' }),                   // kur gerekir
    urun({ costPrice: 10, costCurrency: 'GBP' as 'USD' }),          // tanınmaz
  ];

  it('kur varken yalnız N/A kalır', () => {
    const o = cevrilemeyenler(liste, KURLAR);
    expect(o.kurYok).toBe(0);
    expect(o.na).toEqual({ GBP: 1 });
    expect(o.toplam).toBe(1);
  });

  it('kur yokken hepsini sayar ve hangi birimin eksik olduğunu söyler', () => {
    const o = cevrilemeyenler(liste, null);
    expect(o.kurYok).toBe(2);
    expect(o.eksikBirimler).toEqual(['EUR', 'USD']);
    expect(o.toplam).toBe(3);
  });

  it('her şey TL ise uyarı YOK (gereksiz gürültü çıkarmaz)', () => {
    const o = cevrilemeyenler([urun({ costPrice: 5 }), urun({ costPrice: 7, costCurrency: 'TRY' })], null);
    expect(o.toplam).toBe(0);
    expect(cevrilemeyenMesaji(o)).toBeNull();
  });

  it('mesaj neyin DIŞARIDA kaldığını ve düzeleceğini söylüyor', () => {
    const m = cevrilemeyenMesaji(cevrilemeyenler(liste, null))!;
    expect(m).toContain('kuru bulunamadı');
    expect(m).toContain('DAHİL DEĞİL');
    expect(m).toContain('Kur geldiğinde');
  });
});

describe('fatura tarihine göre kur (kullanıcı kararı 2026-08-26)', () => {
  // Bugünkü kur 40; faturanın kesildiği gün kur 25'ti.
  const BUGUN = { USD: 40 };
  const FATURA_GUNU = '2024-03-15';

  beforeEach(() => { kurArsiviTemizle(); });

  it('fatura tarihi varsa O GÜNÜN kuru kullanılır, bugünkü DEĞİL', () => {
    kurArsiviDoldur(FATURA_GUNU, { USD: 25 });
    const d = urun({ costPrice: 100, costCurrency: 'USD', costDate: FATURA_GUNU });
    expect(itemCostTRY(d, BUGUN)).toBe(2500);   // 100 × 25 — geçmiş dönem değeri
    expect(itemCostTRY(d, BUGUN)).not.toBe(4000); // bugünkü kurla olsaydı
  });

  it('fatura tarihi VAR ama o günün kuru YOKSA güncel kura DÜŞMEZ', () => {
    // İstenen tarihin kuru bilinmiyorsa rakam da bilinmiyordur — sessizce
    // bugünkü kurla değerlemek geçmiş dönem değerini bozar.
    const d = urun({ costPrice: 100, costCurrency: 'USD', costDate: FATURA_GUNU });
    expect(itemCostTRY(d, BUGUN)).toBe(0);
    expect(maliyetDurumu(d, BUGUN)).toEqual({ durum: 'kur-yok', tutar: 100, birim: 'USD' });
  });

  it("uç GÜNCEL kura düşmüşse (source:'fallback') o tarihin kuru SAYILMAZ", () => {
    // /api/exchange-rates/at, TCMB tarihsel kaydını çekemezse güncel kuru
    // `source:'fallback'` ile döndürüyor. Onu fatura tarihinin kuru gibi
    // kullanmak kuralı sessizce bozardı.
    kurArsiviDoldur(FATURA_GUNU, { USD: 40 }, /* yedek */ true);
    const d = urun({ costPrice: 100, costCurrency: 'USD', costDate: FATURA_GUNU });
    expect(itemCostTRY(d, BUGUN)).toBe(0);
    expect(maliyetDurumu(d, BUGUN).durum).toBe('kur-yok');
  });

  it('fatura tarihi YOKSA güncel kur kullanılır ama İŞARETLENİR', () => {
    const d = urun({ costPrice: 100, costCurrency: 'USD' });
    expect(itemCostTRY(d, BUGUN)).toBe(4000);
    expect(maliyetDurumu(d, BUGUN)).toEqual({ durum: 'tl', tl: 4000, tarihsizKur: true });
  });

  it('tarihsiz kalem sayılır ve kullanıcıya söylenir', () => {
    const o = cevrilemeyenler([urun({ costPrice: 100, costCurrency: 'USD' })], BUGUN);
    expect(o.tarihsizKur).toBe(1);
    expect(o.toplam).toBe(0);                       // toplama DAHİL, eksik değil
    expect(cevrilemeyenMesaji(o)).toContain('fatura tarihi yok');
    expect(cevrilemeyenMesaji(o)).toContain('güncel kurla');
  });

  it('TL kalemde tarih hiç sorulmaz', () => {
    const d = urun({ costPrice: 100, costCurrency: 'TRY' });
    expect(maliyetDurumu(d, null)).toEqual({ durum: 'tl', tl: 100 });
    expect(cevrilemeyenler([d], null).tarihsizKur).toBe(0);
  });

  it('maliyetTarihleri yalnız döviz kalemlerin tarihlerini toplar (tekrarsız)', () => {
    const liste = [
      urun({ costPrice: 1, costCurrency: 'USD', costDate: '2024-01-02' }),
      urun({ costPrice: 1, costCurrency: 'EUR', costDate: '2024-01-02' }),  // aynı tarih
      urun({ costPrice: 1, costCurrency: 'USD', costDate: '2024-05-09' }),
      urun({ costPrice: 1, costCurrency: 'TRY', costDate: '2024-07-07' }),  // TL → gerekmez
      urun({ costPrice: 1, costCurrency: 'USD' }),                          // tarihsiz
    ];
    expect(maliyetTarihleri(liste).sort()).toEqual(['2024-01-02', '2024-05-09']);
  });
});

/**
 * `kartMaliyetiTL` — "stok kartında maliyet GİRİLMEMİŞ" hâlini 0'dan ayıran kapı.
 *
 * NEDEN (2026-09-19 hakem bulgusu, OrdersPage.tsx:289): kârlılık çözücüsü
 * `maliyetDurumu(...).durum === 'tl' ? tl : null` süzgecinden geçiyordu; o süzgeç yalnız
 * KUR çevrilememesini eliyor, EKSİK maliyeti elemiyordu. `hamMaliyet` alanı olmayan kart için
 * 0 döndüğünden `{durum:'tl', tl:0}` çıkıyor, çözücü 0 veriyor, modül 0'ı meşru maliyet sayıp
 * marjı %100 yeşil gösteriyordu (Şirin İnşaat / ÇİMENTO 50KG x100 @ ₺110 → "Kâr %100,0").
 */
describe('kartMaliyetiTL — stok kartının BİLİNEN maliyeti (kartta 0 "girilmemiş"tir)', () => {
  it('maliyet alanı YOKSA null — eski süzgeç burada 0 verip marjı %100 gösterirdi', () => {
    const kart = urun({});
    expect(itemCostTRY(kart, KURLAR)).toBe(0);                       // eski yol: sahte "maliyetsiz"
    expect(maliyetDurumu(kart, KURLAR)).toEqual({ durum: 'tl', tl: 0 });
    expect(kartMaliyetiTL(kart, KURLAR)).toBeNull();
  });

  it('kartta costPrice 0 / negatif → null (girilmemiş sayılır)', () => {
    expect(kartMaliyetiTL(urun({ costPrice: 0 }), KURLAR)).toBeNull();
    expect(kartMaliyetiTL(urun({ costPrice: -5 }), KURLAR)).toBeNull();
  });

  it('PARİTE: bilinen maliyette sayı itemCostTRY ile birebir aynı', () => {
    expect(kartMaliyetiTL(urun({ costPrice: 110 }), KURLAR)).toBe(110);
    expect(kartMaliyetiTL(urun({ costPrice: 100, costCurrency: 'USD' }), KURLAR)).toBe(4000);
    expect(kartMaliyetiTL(urun({ cost: 250 }), KURLAR)).toBe(250);   // eski alan adı da okunur
  });

  it('kur yoksa / birim tanınmıyorsa null — 0 DEĞİL', () => {
    expect(kartMaliyetiTL(urun({ costPrice: 100, costCurrency: 'USD' }), null)).toBeNull();
    expect(kartMaliyetiTL(urun({ costPrice: 100, costCurrency: 'GBP' as 'USD' }), KURLAR)).toBeNull();
  });
});

/**
 * `kartSatisTL` — maliyetin AYNASI: satış fiyatının TL karşılığı, bilinmiyorsa null.
 *
 * NEDEN (2026-09-19 delta bulgusu, DashboardPage.tsx:2024 "Stok Değeri Özeti"): kartın MALİYET
 * tarafı `kartMaliyetiTL` ile TL'ye çevriliyor, SATIŞ tarafı ise `finansalOranlar.stokDegeri`ye
 * devrediliyordu; o fonksiyon `prices.Retail ?? price` değerini `priceCurrency`ye HİÇ BAKMADAN
 * stokla çarpıyor. USD fiyatlı kartta panel iki farklı para birimini topluyordu:
 *
 *     priceCurrency 'USD', Retail 12, costCurrency 'USD' 8, stok 1000, kur 41
 *       Maliyet Değeri  8 × 41 × 1000 = ₺328.000
 *       Satış Değeri    12 × 1000     = "₺12.000"   ← dolar rakamı ₺ diye basılıyor (gerçeği ₺492.000)
 *       Brüt marj       (12.000 − 328.000) / 12.000 ≈ −%2633, kırmızı rozetle
 *
 * Hiçbir girdi "bilinmiyor" olmadığı için '—' kapısı da devreye girmiyordu. Aynı hata
 * Raporlar'da 2026-08-22'de `itemPriceTRY` ile kapatılmıştı — burası yarım kalmıştı.
 *
 * `itemPriceTRY` DOĞRUDAN kullanılamaz: kur/fiyat yokken 0 döner, yani kalem sessizce
 * "bedelsiz" olur ve toplamı eksiltir. `kartSatisTL` o hâlde null döner → kalem
 * `Tutar.bilinmeyen`e düşer ve ekran "N kalem tutarsız" der.
 */
describe('kartSatisTL — satış fiyatının BİLİNEN TL karşılığı', () => {
  it('PARİTE: TL fiyatlı kartta sayı `prices.Retail ?? price` ile birebir aynı', () => {
    expect(kartSatisTL(urun({ prices: { Retail: 150 } as InventoryItem['prices'] }), 'Retail', KURLAR)).toBe(150);
    expect(kartSatisTL(urun({ price: 90 } as Partial<InventoryItem>), 'Retail', KURLAR)).toBe(90);
    // Retail BİLİNİYORSA `price` yedeğine DÜŞMEZ (meşru 0 dahil — finansalOranlar.stokDegeri kuralı).
    expect(kartSatisTL(urun({ prices: { Retail: 0 } as InventoryItem['prices'], price: 90 } as Partial<InventoryItem>), 'Retail', KURLAR)).toBe(0);
  });

  it('MUTASYON-AYIRT EDİCİ: USD fiyat kurla çevrilir — dolar rakamı ₺ diye basılmaz', () => {
    const kart = urun({ prices: { Retail: 12 } as InventoryItem['prices'], priceCurrency: 'USD' } as Partial<InventoryItem>);
    expect(kartSatisTL(kart, 'Retail', { USD: 41 })).toBe(492);
    expect(kartSatisTL(kart, 'Retail', { USD: 41 })).not.toBe(12);   // eski davranışın ta kendisi
  });

  it('kur yoksa / birim tanınmıyorsa null — 0 DEĞİL (itemPriceTRY 0 dönüyordu: sessiz eksiltme)', () => {
    const usd = urun({ prices: { Retail: 12 } as InventoryItem['prices'], priceCurrency: 'USD' } as Partial<InventoryItem>);
    expect(itemPriceTRY(usd, 'Retail', null)).toBe(0);               // eski yol
    expect(kartSatisTL(usd, 'Retail', null)).toBeNull();
    expect(kartSatisTL(usd, 'Retail', { USD: 0 })).toBeNull();
    const gbp = urun({ prices: { Retail: 12 } as InventoryItem['prices'], priceCurrency: 'GBP' as 'USD' } as Partial<InventoryItem>);
    expect(kartSatisTL(gbp, 'Retail', KURLAR)).toBeNull();
  });

  it('fiyat alanı hiç yoksa null (0 DEĞİL)', () => {
    expect(kartSatisTL(urun({}), 'Retail', KURLAR)).toBeNull();
    expect(kartSatisTL(urun({ prices: {} as InventoryItem['prices'] }), 'Retail', KURLAR)).toBeNull();
  });
});
