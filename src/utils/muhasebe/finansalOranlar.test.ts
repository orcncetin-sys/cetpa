/**
 * finansalOranlar.test.ts — Muhasebe → Finansal Oranlar (Phase 132) hesap sözleşmesi.
 * Faz 3 1/n (2026-09-13). ÖNCE YAZILDI — modül henüz yokken kırmızı görüldü.
 *
 * Sayfadaki sahte kesinlik: `o.totalPrice || 0`, `li.costPrice ?? 0`, `po.totalAmount || 0`,
 * `i.stockLevel ?? 0`, `prices.Retail ?? price ?? 0`. Bilinmeyen tutar 0 DEĞİL bilinmiyordur:
 * toplama girmez, SAYILIR (`bilinmeyen`), oran null / ekranda '—' + "N kayıt tutarsız".
 */
import { describe, it, expect } from 'vitest';
import {
  mikroCiro, cetpaCiro, cetpaMaliyet, cetpaAlacak, cetpaBorc, stokDegeri,
  cariBakiyeToplamlari, finansalOranlar } from './finansalOranlar';
import { siparisMaliyeti } from '../para';

const BILINMEYENLER: unknown[] = [undefined, null, '', NaN, 'abc', Infinity];

describe('mikroCiro — bu yılın GİDEN (satış) faturaları', () => {
  it('yalnız giden toplanır; gelen (alış) ciro değildir', () => {
    const r = mikroCiro([
      { yon: 'giden', tutar: 100_000 },
      { yon: 'giden', tutar: 50_000 },
      { yon: 'gelen', tutar: 30_000 },
    ]);
    expect(r).toEqual({ toplam: 150_000, bilinen: 2, bilinmeyen: 0 });
  });
  it('tutarı bilinmeyen fatura 0 sayılmaz, sayılır', () => {
    for (const v of BILINMEYENLER) {
      const r = mikroCiro([{ yon: 'giden', tutar: 1_000 }, { yon: 'giden', tutar: v }]);
      expect(r.toplam).toBe(1_000);
      expect(r.bilinmeyen).toBe(1);
    }
  });
  it('boş liste → 0 / 0', () => {
    expect(mikroCiro([])).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('cetpaCiro — Cetpa siparişleri (iptal ve mikro-fatura kaynaklı hariç)', () => {
  it("iptal ve source:'mikro-fatura' dışlanır (mikroCiro aynı faturaları zaten sayıyor)", () => {
    const r = cetpaCiro([
      { totalPrice: 40_000, status: 'Delivered' },
      { totalPrice: 99_999, status: 'Cancelled' },
      { totalPrice: 5_000, status: 'Delivered', source: 'mikro-fatura' },
      { totalPrice: 10_000, status: 'Processing' },
    ]);
    expect(r).toEqual({ toplam: 50_000, bilinen: 2, bilinmeyen: 0 });
  });
  it('bilinmeyen totalPrice toplama girmez, sayılır', () => {
    for (const v of BILINMEYENLER) {
      const r = cetpaCiro([{ totalPrice: v, status: 'Delivered' }, { totalPrice: '1250.5', status: 'Delivered' }]);
      expect(r.toplam).toBe(1250.5);
      expect(r.bilinmeyen).toBe(1);
    }
  });
  it('iptal edilmiş ve tutarsız kayıt bilinmeyen SAYILMAZ (zaten dışarıda)', () => {
    expect(cetpaCiro([{ totalPrice: undefined, status: 'Cancelled' }]).bilinmeyen).toBe(0);
  });
  it('boş liste', () => {
    expect(cetpaCiro([])).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('cetpaMaliyet (COGS) — sipariş maliyeti (para.ts siparisMaliyeti), SİPARİŞ sayılır', () => {
  it('bilinen siparişler toplanır; iptal dışlanır; kalemsiz iptal-dışı sipariş BİLİNMİYOR sayılır (0 katkı değil — karZarar ile aynı kural)', () => {
    const r = cetpaMaliyet([
      { status: 'Delivered', lineItems: [{ costPrice: 500, quantity: 20 }, { costPrice: 200, quantity: 10 }] },
      { status: 'Cancelled', lineItems: [{ costPrice: 9_999, quantity: 1 }] },
      { status: 'Processing' },                 // satırı yok → maliyeti bilinmiyor
      { status: 'Processing', lineItems: [] },  // boş satır listesi de bilinmiyor
    ]);
    expect(r).toEqual({ toplam: 12_000, bilinen: 1, bilinmeyen: 2, biliniyor: true });
  });
  it('costPrice ya da quantity bilinmeyen satır siparişi BİLİNMİYOR yapar — 0 değil, toplama girmez, sayılır', () => {
    for (const v of BILINMEYENLER) {
      const r = cetpaMaliyet([
        { status: 'Delivered', lineItems: [{ costPrice: v, quantity: 4 }] },
        { status: 'Delivered', lineItems: [{ costPrice: 100, quantity: v }] },
        { status: 'Delivered', lineItems: [{ costPrice: 100, quantity: 2 }] },
      ]);
      expect(r.toplam).toBe(200);
      expect(r.bilinmeyen).toBe(2);
      expect(r.bilinen).toBe(1);
      // tek satırı bile bilinmeyen siparişin BİLİNEN satırları da toplama girmez (kısmi maliyet = sahte kesinlik)
      const kismi = cetpaMaliyet([{ status: 'Delivered', lineItems: [{ costPrice: 100, quantity: 2 }, { costPrice: v, quantity: 1 }] }]);
      expect(kismi).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1, biliniyor: false });
    }
  });
  it('DEĞİŞMEZ: Phase 132 ile Phase 143 aynı siparişe aynı "bilinmiyor" cevabını verir (tek kaynak)', () => {
    const adaylar = [
      { status: 'Delivered', source: 'mikro-fatura' },                                  // Mikro türetmesi, satırsız
      { status: 'Delivered', lineItems: [{ costPrice: 100, quantity: 1 }] },
      { status: 'Delivered', lineItems: [{ costPrice: undefined, quantity: 1 }, { costPrice: 5, quantity: 1 }] },
      { status: 'Delivered', lineItems: [] },
    ];
    for (const o of adaylar) {
      expect(cetpaMaliyet([o]).bilinmeyen).toBe(Number.isFinite(siparisMaliyeti(o)) ? 0 : 1);
    }
  });
  it('hiç maliyet girilmemişse biliniyor=false (Mikro-only kurulum: yanıltıcı %100 marj YAZILMAZ)', () => {
    expect(cetpaMaliyet([]).biliniyor).toBe(false);
    expect(cetpaMaliyet([{ status: 'Delivered', lineItems: [{ costPrice: undefined, quantity: 3 }] }]).biliniyor).toBe(false);
    expect(cetpaMaliyet([{ status: 'Delivered', lineItems: [{ costPrice: 0, quantity: 3 }] }]).biliniyor).toBe(false);
  });
});

describe('cetpaAlacak — ödenmemiş, iptal olmayan, ödemesi Cetpa\'da izlenen siparişler', () => {
  it("paid=true, iptal ve Mikro kaynaklı ('mikro-fatura' / 'mikro-siparis') dışlanır", () => {
    const r = cetpaAlacak([
      { totalPrice: 40_000, paid: false, status: 'Delivered' },
      { totalPrice: 10_000, paid: true, status: 'Delivered' },
      { totalPrice: 7_000, paid: false, status: 'Cancelled' },
      { totalPrice: 5_000, status: 'Delivered', source: 'mikro-fatura' },
      { totalPrice: 3_000, status: 'Delivered', source: 'mikro-siparis' },
      { totalPrice: 2_000, status: 'Delivered' }, // paid alanı yok, Cetpa kaynaklı → ödenmemiş sayılır (sayfadaki gibi)
    ]);
    expect(r).toEqual({ toplam: 42_000, bilinen: 2, bilinmeyen: 0 });
  });
  it('bilinmeyen tutar sayılır', () => {
    for (const v of BILINMEYENLER) {
      const r = cetpaAlacak([{ totalPrice: v, paid: false, status: 'Delivered' }]);
      expect(r).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    }
  });
});

describe('cetpaBorc — açık satın alma siparişleri', () => {
  it("'Teslim Alındı' ve 'İptal Edildi' dışlanır", () => {
    const r = cetpaBorc([
      { supplier: 'Şahin İnşaat Malzemeleri', totalAmount: 30_000, status: 'Onaylandı' },
      { supplier: 'Işık Çimento', totalAmount: 999, status: 'Teslim Alındı' },
      { supplier: 'Güneş Demir', totalAmount: 999, status: 'İptal Edildi' },
    ]);
    expect(r).toEqual({ toplam: 30_000, bilinen: 1, bilinmeyen: 0 });
  });
  it('bilinmeyen totalAmount sayılır', () => {
    for (const v of BILINMEYENLER) {
      expect(cetpaBorc([{ totalAmount: v, status: 'Bekliyor' }])).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    }
  });
  it('boş liste', () => {
    expect(cetpaBorc([])).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('stokDegeri — stockLevel × (prices.Retail ?? price)', () => {
  it('Retail fiyatı öncelikli, yoksa price; sayısal string kabul', () => {
    const r = stokDegeri([
      { name: 'Çimento 50 kg', stockLevel: 100, prices: { Retail: 250, 'B2B Standard': 200 } },
      { name: 'İnşaat Demiri Ø12', stockLevel: 10, price: 2_500 },
      { name: 'Şap Kumu', stockLevel: '4', prices: { Retail: '100' } },
    ]);
    expect(r).toEqual({ toplam: 50_400, bilinen: 3, bilinmeyen: 0 });
  });
  it('stok ya da fiyat bilinmeyen ürün 0 DEĞİL — toplama girmez, sayılır', () => {
    for (const v of BILINMEYENLER) {
      const r = stokDegeri([
        { name: 'Alçı', stockLevel: v, prices: { Retail: 50 } },
        { name: 'Kireç', stockLevel: 5, prices: { Retail: v } },
        { name: 'Tuğla', stockLevel: 5 }, // ne prices ne price
        { name: 'Kum', stockLevel: 2, prices: { Retail: 10 } },
      ]);
      expect(r.toplam).toBe(20);
      expect(r.bilinmeyen).toBe(3);
    }
  });
  it('bilinen 0 stok → fiyat bilinmese de değer 0 (0 × x = 0, tahmin değil); tutarsız sayılmaz', () => {
    expect(stokDegeri([{ name: 'Eski Kalem', stockLevel: 0 }])).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
  });
  it('boş envanter', () => {
    expect(stokDegeri([])).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('cariBakiyeToplamlari — Mikro cari bakiyeleri (pozitif=alacak, eksi=Cetpa borçlu)', () => {
  it('işarete göre ayrılır; 0 hiçbirine girmez', () => {
    expect(cariBakiyeToplamlari([60_000, -20_000, 0, '5000', -1_000])).toEqual({ ar: 65_000, ap: 21_000, bilinen: 5, bilinmeyen: 0 });
  });
  it('bilinmeyen bakiye 0 sayılmaz, sayılır', () => {
    for (const v of BILINMEYENLER) {
      expect(cariBakiyeToplamlari([v, 100])).toEqual({ ar: 100, ap: 0, bilinen: 1, bilinmeyen: 1 });
    }
  });
  it('boş', () => {
    expect(cariBakiyeToplamlari([])).toEqual({ ar: 0, ap: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('finansalOranlar — bileşik (sayfadaki formüller birebir)', () => {
  const girdi = {
    mikroFaturalar: [
      { yon: 'giden' as const, tutar: 100_000 },
      { yon: 'giden' as const, tutar: 50_000 },
      { yon: 'gelen' as const, tutar: 30_000 },
    ],
    siparisler: [
      { totalPrice: 40_000, paid: false, status: 'Delivered', lineItems: [{ costPrice: 500, quantity: 20 }] },
      { totalPrice: 10_000, paid: true, status: 'Delivered', lineItems: [{ costPrice: 200, quantity: 10 }] },
      { totalPrice: 99_999, paid: false, status: 'Cancelled', lineItems: [{ costPrice: 1, quantity: 1 }] },
      // mikro-fatura kaynaklı: ciroya GİRMEZ (mikroCiro sayıyor), COGS'a girer (sayfadaki gibi)
      { totalPrice: 5_000, status: 'Delivered', source: 'mikro-fatura', lineItems: [{ costPrice: 100, quantity: 5 }] },
    ],
    satinAlmaSiparisleri: [
      { totalAmount: 30_000, status: 'Onaylandı' },
      { totalAmount: 999, status: 'Teslim Alındı' },
      { totalAmount: 999, status: 'İptal Edildi' },
    ],
    envanter: [
      { stockLevel: 100, prices: { Retail: 250 } },
      { stockLevel: 10, price: 2_500 },
    ],
    cariBakiye: { ar: 60_000, ap: 20_000 },
  };

  it('tam veri: 5 oran da sayısal, bilinmeyen 0', () => {
    const r = finansalOranlar(girdi);
    expect(r.ciro).toMatchObject({ mikro: 150_000, cetpa: 50_000, toplam: 200_000, bilinmeyen: 0 });
    expect(r.cogs).toMatchObject({ toplam: 12_500, biliniyor: true, bilinmeyen: 0 });
    expect(r.brutKar).toBe(187_500);
    expect(r.alacak).toMatchObject({ cetpa: 40_000, toplam: 100_000, bilinmeyen: 0 });
    expect(r.borc).toMatchObject({ cetpa: 30_000, toplam: 50_000, bilinmeyen: 0 });
    expect(r.stokDegeri).toMatchObject({ toplam: 50_000, bilinmeyen: 0 });
    expect(r.oranlar.brutKarMarji).toEqual({ deger: 93.75, bilinmeyen: 0 });
    expect(r.oranlar.cariOran).toEqual({ deger: 3, bilinmeyen: 0 });          // (100k + 50k) / 50k
    expect(r.oranlar.alacakDevirHizi).toEqual({ deger: 2, bilinmeyen: 0 });   // 200k / 100k
    expect(r.oranlar.dso).toEqual({ deger: 182.5, bilinmeyen: 0 });           // 100k / 200k × 365
    expect(r.oranlar.stokDevirHizi).toEqual({ deger: 0.25, bilinmeyen: 0 });  // 12.5k / 50k
  });

  it('COGS bilinmiyor (Mikro-only) → brüt marj ve stok devir null, diğerleri hesaplanır', () => {
    const r = finansalOranlar({ ...girdi, siparisler: girdi.siparisler.map(s => ({ ...s, lineItems: undefined })) });
    expect(r.cogs.biliniyor).toBe(false);
    expect(r.brutKar).toBeNull();
    expect(r.oranlar.brutKarMarji.deger).toBeNull();
    expect(r.oranlar.stokDevirHizi.deger).toBeNull();
    expect(r.oranlar.cariOran.deger).toBe(3);
    expect(r.oranlar.alacakDevirHizi.deger).toBe(2);
  });

  it('payda 0 → null (AP 0 → cari oran; AR 0 → alacak devir; ciro 0 → DSO ve marj)', () => {
    const r1 = finansalOranlar({ ...girdi, satinAlmaSiparisleri: [], cariBakiye: { ar: 60_000, ap: 0 } });
    expect(r1.oranlar.cariOran.deger).toBeNull();
    const r2 = finansalOranlar({ ...girdi, cariBakiye: { ar: 0, ap: 20_000 }, siparisler: girdi.siparisler.map(s => ({ ...s, paid: true })) });
    expect(r2.oranlar.alacakDevirHizi.deger).toBeNull();
    expect(r2.oranlar.dso.deger).toBe(0);
    const r3 = finansalOranlar({ ...girdi, mikroFaturalar: [], siparisler: [] });
    expect(r3.oranlar.dso.deger).toBeNull();
    expect(r3.oranlar.brutKarMarji.deger).toBeNull();
  });

  it('boş girdi → tüm oranlar null, bilinmeyen 0 (sahte %0 / 0x yok)', () => {
    const r = finansalOranlar({ mikroFaturalar: [], siparisler: [], satinAlmaSiparisleri: [], envanter: [], cariBakiye: { ar: 0, ap: 0 } });
    for (const o of Object.values(r.oranlar)) expect(o).toEqual({ deger: null, bilinmeyen: 0 });
    expect(r.brutKar).toBeNull();
  });

  it('bilinmeyen sayaçları ilgili orana taşınır (ekran: bilinmeyen>0 → "—" + N kayıt tutarsız)', () => {
    const r = finansalOranlar({
      ...girdi,
      siparisler: [...girdi.siparisler, { totalPrice: null, paid: false, status: 'Delivered', lineItems: [{ costPrice: null, quantity: 2 }] }],
      envanter: [...girdi.envanter, { stockLevel: 3 }],
      satinAlmaSiparisleri: [...girdi.satinAlmaSiparisleri, { totalAmount: '', status: 'Bekliyor' }],
      cariBakiye: { ar: 60_000, ap: 20_000, bilinmeyen: 1 },
    });
    expect(r.ciro.bilinmeyen).toBe(1);      // totalPrice null
    expect(r.cogs.bilinmeyen).toBe(1);      // costPrice null
    expect(r.alacak.bilinmeyen).toBe(1);    // aynı sipariş ödenmemiş
    expect(r.borc.bilinmeyen).toBe(1);      // totalAmount ''
    expect(r.stokDegeri.bilinmeyen).toBe(1);
    expect(r.oranlar.brutKarMarji.bilinmeyen).toBe(2);   // ciro + cogs
    expect(r.oranlar.cariOran.bilinmeyen).toBe(4);       // alacak + stok + borç + cari
    expect(r.oranlar.alacakDevirHizi.bilinmeyen).toBe(3); // ciro + alacak + cari
    expect(r.oranlar.dso.bilinmeyen).toBe(3);
    expect(r.oranlar.stokDevirHizi.bilinmeyen).toBe(2);  // cogs + stok
    // bilinen kısımdan hesap yine yapılır — '—' kararı ekranındır
    expect(r.oranlar.brutKarMarji.deger).toBe(93.75);
  });
});
