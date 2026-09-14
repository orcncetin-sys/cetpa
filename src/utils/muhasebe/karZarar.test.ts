/**
 * karZarar.test.ts — MuhasebePage Phase 143 P&L + Başabaş hesaplarının sözleşmesi (Faz 3 1/n). ÖNCE YAZILDI.
 *
 * Sayfadaki sahte kesinlik: `f.tutar || 0`, `o.totalPrice || 0`, `(li.costPrice ?? 0) * li.quantity`,
 * `i.prices?.Retail ?? i.price ?? 0`, marj/başabaş "0" (ciro yokken). Kural (CLAUDE.md):
 * bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR, ekranda '—'.
 */
import { describe, it, expect } from 'vitest';
import {
  ayKarZarar, sonAylarKarZarar, karZararOzeti, basabas, cubukYuzdeleri, kurEtiketi,
  SGA_ORANI, type KzSiparis, type KzFatura, type KzUrun,
} from './karZarar';
import { siparisMaliyeti, ekranTutari } from '../para';

const AGU = (gun: number) => new Date(2026, 7, gun); // Ağustos 2026

const insaat: KzSiparis = { id: 'S1', createdAt: '2026-08-03T10:00:00Z', status: 'Delivered', totalPrice: 1500,
  lineItems: [{ costPrice: 400, quantity: 2 }, { costPrice: 50, quantity: '4' }] };                 // maliyet 1000
const senturkFaturali: KzSiparis = { id: 'S2', createdAt: { _seconds: AGU(10).getTime() / 1000 }, status: 'Shipped',
  totalPrice: 999, faturali: true, lineItems: [{ costPrice: 300, quantity: 1 }] };                  // gelir Mikro'da, maliyet 300
const mikroTuretme: KzSiparis = { id: 'S3', createdAt: AGU(12), status: 'Delivered', totalPrice: 2000, source: 'mikro-fatura' }; // satır yok → maliyet bilinmiyor
const iptal: KzSiparis = { id: 'S4', createdAt: AGU(15), status: 'Cancelled', totalPrice: 5000, lineItems: [{ costPrice: 1, quantity: 1 }] };
const tarihsiz: KzSiparis = { id: 'S5', status: 'Delivered', totalPrice: 7777, lineItems: [{ costPrice: 1, quantity: 1 }] };
const temmuz: KzSiparis = { id: 'S6', createdAt: '15.07.2026', status: 'Delivered', totalPrice: 100, lineItems: [{ costPrice: 10, quantity: 1 }] };
const tutarsiz: KzSiparis = { id: 'S7', createdAt: AGU(20), status: 'Delivered', totalPrice: undefined, lineItems: [{ costPrice: 100, quantity: 1 }] };

const faturalar: KzFatura[] = [
  { yon: 'giden', tarih: '2026-08-05', tutar: 3000 },
  { yon: 'gelen', tarih: '2026-08-06', tutar: 700 },     // alış — gelir değil
  { yon: 'giden', tarih: '2026-07-30', tutar: 4444 },    // Temmuz
  { yon: 'giden', tarih: '2026-08-21', tutar: null },     // tutarı bilinmeyen
];

describe('siparisMaliyeti (para.ts tek kaynak) — P&L bu kuralla sayar', () => {
  it('bilinen satırlar toplanır; sayısal string miktar kabul', () => {
    expect(siparisMaliyeti(insaat)).toBe(1000);
  });
  it("tek satırın costPrice'ı bilinmiyorsa sipariş maliyeti NaN (eskiden `?? 0` ile eksik toplam)", () => {
    for (const cp of [undefined, null, '', NaN, 'abc']) {
      expect(siparisMaliyeti({ lineItems: [{ costPrice: 5, quantity: 1 }, { costPrice: cp, quantity: 2 }] })).toBeNaN();
    }
  });
  it('satırı olmayan (boş ya da yok) siparişin maliyeti BİLİNMİYOR — 0 değil (Mikro türetmesi %100 brüt marj basıyordu)', () => {
    expect(siparisMaliyeti({ lineItems: [] })).toBeNaN();
    expect(siparisMaliyeti(mikroTuretme)).toBeNaN();
  });
});

describe('ayKarZarar — tek ay gelir/maliyet', () => {
  const ay = ayKarZarar([insaat, senturkFaturali, mikroTuretme, iptal, tarihsiz, temmuz, tutarsiz], faturalar, new Date(2026, 7, 1));
  it('gelir = faturasız native siparişler + Mikro giden faturalar; faturalı/Mikro-türetme/iptal/tarihsiz/diğer ay dışarıda', () => {
    expect(ay.gelir).toBe(1500 + 3000);
  });
  it('tutarı bilinmeyen sipariş ve fatura toplama GİRMEZ, SAYILIR', () => {
    expect(ay.gelirBilinmeyen).toBe(2); // tutarsiz + null tutarlı giden fatura
  });
  it('maliyet TÜM iptal-dışı ay siparişlerinden (faturalı dahil); satırsız/bilinmeyen sayılır', () => {
    expect(ay.maliyet).toBe(1000 + 300 + 100);
    expect(ay.maliyetBilinmeyen).toBe(1); // mikroTuretme
  });
  it('herhangi bir taraf eksikse brüt kâr null (kısmi rakamlardan kâr uydurulmaz)', () => {
    expect(ay.brutKar).toBeNull();
  });
  it('temiz ayda brüt kâr = gelir − maliyet; boş ayda 0/0 gerçek sıfırdır', () => {
    const temiz = ayKarZarar([insaat], [{ yon: 'giden', tarih: '2026-08-05', tutar: 500 }], new Date(2026, 7, 1));
    expect(temiz).toMatchObject({ gelir: 2000, gelirBilinmeyen: 0, maliyet: 1000, maliyetBilinmeyen: 0, brutKar: 1000 });
    expect(ayKarZarar([], [], new Date(2026, 7, 1))).toMatchObject({ gelir: 0, maliyet: 0, brutKar: 0, gelirBilinmeyen: 0, maliyetBilinmeyen: 0 });
  });
  it('createdAt her biçimde çözülür (ISO, {_seconds}, Date, GG.AA.YYYY)', () => {
    const tem = ayKarZarar([temmuz, insaat], [], new Date(2026, 6, 1));
    expect(tem.gelir).toBe(100);
  });
});

describe('sonAylarKarZarar — son N ay penceresi', () => {
  it('6 ay, en eskiden bugüne, her ayın ilk günü', () => {
    const aylar = sonAylarKarZarar([insaat], faturalar, { simdi: new Date(2026, 8, 15), aySayisi: 6 });
    expect(aylar).toHaveLength(6);
    expect(aylar[0].ay).toEqual(new Date(2026, 3, 1));
    expect(aylar[5].ay).toEqual(new Date(2026, 8, 1));
    expect(aylar[4]).toMatchObject({ gelir: 4500, gelirBilinmeyen: 1 }); // Ağustos
    expect(aylar[3]).toMatchObject({ gelir: 4444 });                     // Temmuz yalnız Mikro
  });
  it('boş listelerle sıfır aylar (bilinmeyen yok)', () => {
    const aylar = sonAylarKarZarar([], [], { simdi: new Date(2026, 8, 15) });
    expect(aylar.every(a => a.gelir === 0 && a.gelirBilinmeyen === 0 && a.brutKar === 0)).toBe(true);
  });
});

describe('karZararOzeti — dönem toplamı, SG&A, marjlar', () => {
  const temizAylar = sonAylarKarZarar([insaat, senturkFaturali], [{ yon: 'giden', tarih: '2026-08-05', tutar: 500 }], { simdi: new Date(2026, 8, 15) });
  it('temiz: gelir/maliyet/brüt/SG&A(%12)/EBIT/marjlar sayı', () => {
    const o = karZararOzeti(temizAylar);
    expect(o.gelir).toMatchObject({ toplam: 2000, bilinmeyen: 0 });
    expect(o.gelir.bilinen).toBe(2);   // 1 faturasız sipariş + 1 Mikro faturası
    expect(o.maliyet).toMatchObject({ toplam: 1300, bilinmeyen: 0 });
    expect(o.brutKar).toBe(700);
    expect(o.isletmeGideri).toBeCloseTo(2000 * SGA_ORANI);
    expect(o.ebit).toBeCloseTo(700 - 240);
    expect(o.brutMarj).toBeCloseTo(35);
    expect(o.netMarj).toBeCloseTo(23);
  });
  it('ciro 0 → marjlar null (eskiden %0 sahte kesinlik)', () => {
    const o = karZararOzeti(sonAylarKarZarar([], [], { simdi: new Date(2026, 8, 15) }));
    expect(o.gelir).toMatchObject({ toplam: 0, bilinmeyen: 0 });
    expect(o.brutMarj).toBeNull();
    expect(o.netMarj).toBeNull();
  });
  it('bilinmeyen kayıt varsa toplam kısmi + sayaç; türev rakamlar null', () => {
    const o = karZararOzeti(sonAylarKarZarar([insaat, mikroTuretme, tutarsiz], faturalar, { simdi: new Date(2026, 8, 15) }));
    expect(o.gelir).toMatchObject({ toplam: 1500 + 3000 + 4444, bilinmeyen: 2 });
    expect(o.maliyet.bilinmeyen).toBe(1);
    expect(o.brutKar).toBeNull();
    expect(o.isletmeGideri).toBeNull();
    expect(o.ebit).toBeNull();
    expect(o.brutMarj).toBeNull();
    expect(o.netMarj).toBeNull();
  });
  it('ekranTutari (para.ts, TEK sözleşme): hiç bilinen yokken NaN; kısmi bilinmeyen → kısmi toplam + sayfa notu', () => {
    expect(ekranTutari({ toplam: 42, bilinen: 1, bilinmeyen: 0 })).toBe(42);
    expect(ekranTutari({ toplam: 42, bilinen: 1, bilinmeyen: 3 })).toBe(42);
    expect(ekranTutari({ toplam: 0, bilinen: 0, bilinmeyen: 3 })).toBeNaN();
    expect(ekranTutari(karZararOzeti(sonAylarKarZarar([{ totalPrice: null, createdAt: '2026-09-01' }], [], { simdi: new Date(2026, 8, 15) })).gelir)).toBeNaN();
  });
});

describe('basabas — başabaş noktası (tüm iptal-dışı siparişler)', () => {
  const urunler: KzUrun[] = [
    { prices: { Retail: 200, 'B2B Standard': 150 } },
    { prices: {}, price: 100 },
    { prices: { Retail: undefined }, price: null },   // fiyatı bilinmeyen — ortalamaya girmez
  ];
  it('temiz: marj %, sabit gider %12, başabaş ciro, güvenlik marjı, adet (bilinen ortalama fiyattan)', () => {
    const b = basabas([insaat, iptal, senturkFaturali], urunler); // gelir 2499, maliyet 1300 (iptal hariç)
    expect(b.gelir).toMatchObject({ toplam: 2499, bilinmeyen: 0 });
    expect(b.maliyet).toMatchObject({ toplam: 1300, bilinmeyen: 0 });
    const marj = (2499 - 1300) / 2499;
    expect(b.brutMarj).toBeCloseTo(marj * 100);
    expect(b.sabitGider).toBeCloseTo(2499 * SGA_ORANI);
    expect(b.basabasCiro).toBeCloseTo((2499 * SGA_ORANI) / marj);
    expect(b.guvenlikMarji).toBe(Math.round(((2499 - (2499 * SGA_ORANI) / marj) / 2499) * 100));
    expect(b.ortalamaFiyat).toEqual({ ortalama: 150, bilinmeyen: 1 });
    expect(b.basabasAdet).toBe(Math.round((2499 * SGA_ORANI) / marj / 150));
  });
  it('boş sipariş listesi: gelir 0 gerçek, marj/başabaş/güvenlik null (eskiden 0)', () => {
    const b = basabas([], urunler);
    expect(b.gelir).toMatchObject({ toplam: 0, bilinmeyen: 0 });
    expect(b.brutMarj).toBeNull();
    expect(b.basabasCiro).toBeNull();
    expect(b.guvenlikMarji).toBeNull();
    expect(b.basabasAdet).toBeNull();
  });
  it('tutarı bilinmeyen sipariş sayılır, türevler null; marj ≤ 0 iken başabaş null', () => {
    expect(basabas([insaat, tutarsiz], urunler)).toMatchObject({ gelir: { toplam: 1500, bilinmeyen: 1 }, brutMarj: null, basabasCiro: null, guvenlikMarji: null });
    const zarar = basabas([{ createdAt: AGU(1), status: 'Delivered', totalPrice: 100, lineItems: [{ costPrice: 100, quantity: 2 }] }], urunler);
    expect(zarar.brutMarj).toBeCloseTo(-100);
    expect(zarar.basabasCiro).toBeNull();
  });
  it('fiyatı bilinen ürün yoksa ortalama null → adet null (eskiden `?? 0` ile ortalama 0 → Math.max(…,1) ile adet = ciro)', () => {
    const b = basabas([insaat], [{ prices: {}, price: undefined }]);
    expect(b.ortalamaFiyat).toEqual({ ortalama: null, bilinmeyen: 1 });
    expect(b.basabasAdet).toBeNull();
  });
  it("Retail alanı VAR ama sayı değilse ('', 'abc', NaN) price'a düşer — finansalOranlar.stokDegeri ile aynı kural (eskiden `??` düşmüyor, ürün bilinmeyen sayılıyordu)", () => {
    const b = basabas([insaat], [
      { prices: { Retail: 'abc' }, price: 100 },
      { prices: { Retail: '' }, price: 300 },
      { prices: { Retail: NaN }, price: 200 },
      { prices: { Retail: '50' }, price: 999 },   // sayısal string Retail öncelikli
      { prices: { Retail: 'x' }, price: null },   // ikisi de bilinmiyor → sayılır
    ]);
    expect(b.ortalamaFiyat).toEqual({ ortalama: (100 + 300 + 200 + 50) / 4, bilinmeyen: 1 });
  });
});

describe('cubukYuzdeleri — aylık grafik genişlikleri', () => {
  it('bilinen ayların en büyüğüne göre %, brüt kâr negatifse 0, bilinmeyen ay null', () => {
    const aylar = sonAylarKarZarar([insaat, tutarsiz], [{ yon: 'giden', tarih: '2026-07-05', tutar: 3000 }], { simdi: new Date(2026, 8, 15) });
    const y = cubukYuzdeleri(aylar);
    expect(y[3]).toEqual({ gelirYuzde: 100, brutKarYuzde: 100 });   // Temmuz: 3000 gelir, maliyet 0
    expect(y[4]).toEqual({ gelirYuzde: null, brutKarYuzde: null }); // Ağustos: tutarsiz var
    expect(y[0]).toEqual({ gelirYuzde: 0, brutKarYuzde: 0 });
  });
  it('tüm aylar sıfırken 0 (NaN/Infinity değil)', () => {
    expect(cubukYuzdeleri(sonAylarKarZarar([], [], { simdi: new Date(2026, 8, 15) }))[0]).toEqual({ gelirYuzde: 0, brutKarYuzde: 0 });
  });
});

describe('kurEtiketi — "₺1 = $x" etiketi için oran', () => {
  it('TRY → 1; kur varsa 1/kur; kur yoksa/0/NaN → null (rakam basılmaz)', () => {
    expect(kurEtiketi('TRY', null)).toBe(1);
    expect(kurEtiketi('USD', { USD: 40 })).toBeCloseTo(0.025);
    expect(kurEtiketi('USD', null)).toBeNull();
    expect(kurEtiketi('USD', {})).toBeNull();
    expect(kurEtiketi('EUR', { EUR: 0 })).toBeNull();
    expect(kurEtiketi('EUR', { EUR: NaN })).toBeNull();
  });
});
