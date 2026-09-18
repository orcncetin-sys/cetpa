/**
 * gelirTablosu.test.ts — Muhasebe → Gelir Tablosu sekmesinin (GelirTablosuTab.tsx 29-69) HESAP
 * sözleşmesi (Faz 3 2/n, 2026-09-14). ÖNCE YAZILDI.
 *
 * Sayfadaki sahte kesinlik: `(li.costPrice || 0) * li.quantity`, `(o.lineItems || [])` (satırsız sipariş
 * 0 maliyetli → %100 brüt marj), `(e.salary || 0)`, marj `netSatislar > 0 ? … : 0` ("%0"), elle
 * createdAt parse (`new Date(raw)` — dbClient Timestamp → Invalid Date → sipariş sessizce dönem dışı).
 * Kural (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR, ekranda '—'.
 */
import { describe, it, expect } from 'vitest';
import { gelirTablosu, VERGI_ORANI, type GtSiparis, type GtPersonel } from './gelirTablosu';
import { ekranTutari } from '../para';

const AGU = (gun: number) => new Date(2026, 7, gun); // Ağustos 2026
const YIL = 2026, AY = 8;

// ── Siparişler (₺) ──────────────────────────────────────────────────────────────────────────
const sirin: GtSiparis = { id: 'S1', createdAt: '2026-08-03T10:00:00Z', status: 'Delivered', totalPrice: 12000,
  lineItems: [{ costPrice: 2500, quantity: 2 }, { costPrice: '500', quantity: 4 }] };            // Şirin İnşaat — maliyet 7000
const celik: GtSiparis = { id: 'S2', createdAt: { _seconds: AGU(10).getTime() / 1000, _nanoseconds: 0 }, status: 'Shipped',
  totalPrice: 8000, lineItems: [{ costPrice: 3000, quantity: 1 }] };                             // Çelik Yapı — dbClient Timestamp biçimi, maliyet 3000
const iptalYapi: GtSiparis = { id: 'S3', createdAt: AGU(15), status: 'Cancelled', totalPrice: 5000,
  lineItems: [{ costPrice: 1000, quantity: 1 }] };                                                // iptal — brütte var, iade satırında düşülür
const gunluk: GtSiparis = { id: 'S4', createdAt: '2026-08-01', status: 'Delivered', totalPrice: 1000,
  lineItems: [{ costPrice: 100, quantity: 5 }] };                                                 // tarih-only string → yerel gün, maliyet 500
const tarihsiz: GtSiparis = { id: 'S5', status: 'Delivered', totalPrice: 99999, lineItems: [{ costPrice: 1, quantity: 1 }] };
const temmuz: GtSiparis = { id: 'S6', createdAt: '15.07.2026', status: 'Delivered', totalPrice: 700, lineItems: [{ costPrice: 10, quantity: 1 }] };

const donem = [sirin, celik, iptalYapi, gunluk, tarihsiz, temmuz];

// ── Personel ────────────────────────────────────────────────────────────────────────────────
const ayse: GtPersonel = { name: 'Ayşe Şirin', salary: 30000, status: 'Aktif' };
const mehmet: GtPersonel = { name: 'Mehmet Çelik', salary: 25000, status: 'Aktif' };
const ayrilan: GtPersonel = { name: 'Ali Ayrılan', salary: 40000, status: 'Ayrıldı' };
const izinli: GtPersonel = { name: 'Zeynep İzinli', salary: 20000, status: 'İzinli' };
const personel = [ayse, mehmet, ayrilan, izinli];

/**
 * ESKİ HESAP (GelirTablosuTab.tsx 29-69, kelimesi kelimesine) — sayfa paritesi kanıtı.
 * Yalnız tamamen bilinen, Date/ISO tarihli veride çalışır (eski parse Timestamp'i çözemezdi).
 */
function eskiGelirTablosu(orders: readonly GtSiparis[], employees: readonly GtPersonel[], gtYear: number, gtMonth: number) {
  const periodOrders = orders.filter(o => {
    const raw = o.createdAt;
    const d: Date = raw && typeof (raw as { toDate?: () => Date }).toDate === 'function'
      ? (raw as { toDate: () => Date }).toDate()
      : new Date(raw as string);
    return d.getFullYear() === gtYear && d.getMonth() + 1 === gtMonth;
  });
  const brutSatislar = periodOrders.reduce((s, o) => s + (o.totalPrice as number), 0);
  const satisIadeleri = periodOrders.filter(o => o.status === 'Cancelled').reduce((s, o) => s + (o.totalPrice as number), 0);
  const netSatislar = brutSatislar - satisIadeleri;
  const satislarinMaliyeti = periodOrders.reduce((s, o) => s + (o.lineItems || []).reduce((sc: number, li) => sc + ((li.costPrice as number) || 0) * (li.quantity as number), 0), 0);
  const brutKar = netSatislar - satislarinMaliyeti;
  const brutKarMarji = netSatislar > 0 ? (brutKar / netSatislar * 100) : 0;
  const personelGiderleri = employees.filter(e => e.status === 'Aktif').reduce((s, e) => s + ((e.salary as number) || 0), 0);
  const faaliyetKari = brutKar - personelGiderleri;
  const faaliyetKarMarji = netSatislar > 0 ? (faaliyetKari / netSatislar * 100) : 0;
  const vergionceKar = faaliyetKari;
  const vergiKarsiligi = vergionceKar > 0 ? vergionceKar * 0.20 : 0;
  return { periodOrders, brutSatislar, satisIadeleri, netSatislar, satislarinMaliyeti, brutKar, brutKarMarji, personelGiderleri, faaliyetKari, faaliyetKarMarji, vergionceKar, vergiKarsiligi, netDonemKari: vergionceKar - vergiKarsiligi };
}

describe('gelirTablosu — dönem filtresi', () => {
  const gt = gelirTablosu(donem, personel, YIL, AY);
  it('yıl+ay eşleşen siparişler (iptal DAHİL); diğer ay ve tarihsiz dışarıda', () => {
    expect(gt.siparisSayisi).toBe(4); // sirin, celik, iptalYapi, gunluk
  });
  it('tarihi çözülemeyen sipariş sessizce düşmez — SAYILIR', () => {
    expect(gt.tarihsiz).toBe(1);
    expect(gelirTablosu([tarihsiz, { createdAt: null, totalPrice: 1 }], [], YIL, AY).tarihsiz).toBe(2);
  });
  it('dbClient Timestamp ({_seconds}) tarihli sipariş döneme GİRER (eski `new Date(raw)` Invalid Date verip sessizce düşürüyordu — bilinçli fark)', () => {
    expect(gelirTablosu([celik], [], YIL, AY).siparisSayisi).toBe(1);
    expect(eskiGelirTablosu([celik], [], YIL, AY).periodOrders.length).toBe(0); // eski davranışın kanıtı
  });
  it("tarih-only ve 'GG.AA.YYYY' string'leri yerel gün olarak çözülür", () => {
    expect(gelirTablosu([gunluk, { createdAt: '20.08.2026', totalPrice: 1 }], [], YIL, AY).siparisSayisi).toBe(2);
    expect(gelirTablosu([temmuz], [], YIL, AY).siparisSayisi).toBe(0);
    expect(gelirTablosu([temmuz], [], 2026, 7).siparisSayisi).toBe(1);
  });
});

describe('gelirTablosu — satışlar (I/II)', () => {
  const gt = gelirTablosu(donem, personel, YIL, AY);
  it('brüt satış = dönemdeki TÜM siparişlerin tutarı (iptal dahil)', () => {
    expect(gt.brutSatis).toEqual({ toplam: 26000, bilinen: 4, bilinmeyen: 0 });
  });
  it('iade = iptal siparişlerin tutarı; net = brüt − iade', () => {
    expect(gt.iade).toEqual({ toplam: 5000, bilinen: 1, bilinmeyen: 0 });
    expect(gt.netSatis).toBe(21000);
  });
  it('tutarı bilinmeyen sipariş brüte 0 diye GİRMEZ, sayılır; net (türetme) bilinmez olur', () => {
    for (const tp of [undefined, null, '', 'abc', NaN]) {
      const g = gelirTablosu([...donem, { createdAt: AGU(20), status: 'Delivered', totalPrice: tp, lineItems: [{ costPrice: 1, quantity: 1 }] }], personel, YIL, AY);
      expect(g.brutSatis).toEqual({ toplam: 26000, bilinen: 4, bilinmeyen: 1 });
      expect(ekranTutari(g.brutSatis)).toBe(26000);          // ekran: kısmi toplam + "1 kayıt tutarsız" notu
      expect(g.netSatis).toBeNaN();                          // türetme: tamTutar → '—'
      expect(g.brutKar).toBeNaN();
      expect(g.brutKarMarji).toBeNull();
      expect(g.faaliyetKari).toBeNaN();
      expect(g.faaliyetKarMarji).toBeNull();
    }
  });
  it('tutarı bilinmeyen İPTAL siparişi iade satırında da sayılır', () => {
    const g = gelirTablosu([sirin, { createdAt: AGU(21), status: 'Cancelled', totalPrice: null }], [], YIL, AY);
    expect(g.iade).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(ekranTutari(g.iade)).toBeNaN();                   // hiç bilinen yok → '—'
    expect(g.brutSatis.bilinmeyen).toBe(1);
    expect(g.netSatis).toBeNaN();
  });
});

describe('gelirTablosu — satışların maliyeti (III) ve brüt kâr (IV)', () => {
  const gt = gelirTablosu(donem, personel, YIL, AY);
  it('SMM = Σ costPrice × quantity, dönemdeki TÜM siparişler (iptal dahil — sayfa paritesi); sayısal string kabul', () => {
    expect(gt.smm).toEqual({ toplam: 11500, bilinen: 4, bilinmeyen: 0 });
    expect(gt.brutKar).toBe(21000 - 11500);
    expect(gt.brutKarMarji).toBeCloseTo((9500 / 21000) * 100, 6);
  });
  it('satırı OLMAYAN sipariş 0 maliyetli sayılmaz — bilinmeyen sayılır, brüt kâr/marj bilinmez (eski: %100 marj)', () => {
    const mikroTuretme: GtSiparis = { createdAt: AGU(12), status: 'Delivered', totalPrice: 2000 }; // Mikro faturasından türetilmiş, satırsız
    const g = gelirTablosu([...donem, mikroTuretme], personel, YIL, AY);
    expect(g.brutSatis.toplam).toBe(28000);
    expect(g.netSatis).toBe(23000);                           // satış tarafı tamamen bilinir
    expect(g.smm).toEqual({ toplam: 11500, bilinen: 4, bilinmeyen: 1 }); // `|| 0` geri gelirse bilinmeyen 0 olur → kırılır
    expect(g.brutKar).toBeNaN();                              // `|| 0` geri gelirse 11500 çıkar → kırılır
    expect(g.brutKarMarji).toBeNull();
    expect(g.faaliyetKari).toBeNaN();
    expect(g.vergiOncesiKar).toBeNaN();
    expect(g.netDonemKari).toBeNaN();
  });
  it("tek satırın costPrice'ı ya da miktarı bilinmiyorsa o sipariş maliyetsiz sayılır (eski `costPrice || 0` eksik toplam)", () => {
    const eksik: GtSiparis = { createdAt: AGU(13), status: 'Delivered', totalPrice: 100, lineItems: [{ costPrice: 10, quantity: 1 }, { costPrice: undefined, quantity: 3 }] };
    const g = gelirTablosu([sirin, eksik], [], YIL, AY);
    expect(g.smm).toEqual({ toplam: 7000, bilinen: 1, bilinmeyen: 1 });
    expect(g.brutKar).toBeNaN();
    const miktarsiz: GtSiparis = { createdAt: AGU(13), status: 'Delivered', totalPrice: 100, lineItems: [{ costPrice: 10, quantity: null }] };
    expect(gelirTablosu([miktarsiz], [], YIL, AY).smm.bilinmeyen).toBe(1);
  });
  it('sadece iptal sipariş olan dönemde net 0 → marj null (eski "%0"); brüt kâr sayıdır (0 − maliyet)', () => {
    const g = gelirTablosu([iptalYapi], personel, YIL, AY);
    expect(g.netSatis).toBe(0);
    expect(g.brutKar).toBe(-1000);
    expect(g.brutKarMarji).toBeNull();
    expect(g.faaliyetKarMarji).toBeNull();
  });
});

describe('gelirTablosu — faaliyet giderleri (V) ve faaliyet kârı (VI)', () => {
  const gt = gelirTablosu(donem, personel, YIL, AY);
  it("personel gideri yalnız 'Aktif' personelin maaşı (Ayrıldı/İzinli dışarıda)", () => {
    expect(gt.personel).toEqual({ toplam: 55000, bilinen: 2, bilinmeyen: 0 });
    expect(gt.pazarlama).toBe(0);
    expect(gt.genelYonetim).toBe(0);
    expect(gt.faaliyetGideri).toEqual({ toplam: 55000, bilinen: 2, bilinmeyen: 0 });
  });
  it('faaliyet kârı = brüt kâr − faaliyet gideri; marj net satışa göre', () => {
    expect(gt.faaliyetKari).toBe(9500 - 55000);
    expect(gt.faaliyetKarMarji).toBeCloseTo((-45500 / 21000) * 100, 6);
  });
  it('maaşı bilinmeyen AKTİF personel 0 gider sayılmaz — sayılır; faaliyet kârı bilinmez, brüt kâr etkilenmez', () => {
    for (const maas of [undefined, null, '', NaN]) {
      const g = gelirTablosu(donem, [...personel, { name: 'Maaşsız', salary: maas, status: 'Aktif' }], YIL, AY);
      expect(g.personel).toEqual({ toplam: 55000, bilinen: 2, bilinmeyen: 1 }); // `|| 0` geri gelirse bilinmeyen 0 → kırılır
      expect(g.faaliyetGideri.bilinmeyen).toBe(1);
      expect(g.brutKar).toBe(9500);
      expect(g.brutKarMarji).not.toBeNull();
      expect(g.faaliyetKari).toBeNaN();                       // `|| 0` geri gelirse −45500 → kırılır
      expect(g.faaliyetKarMarji).toBeNull();
    }
  });
  it("maaşı bilinmeyen ama 'Ayrıldı' personel sayılmaz (dışlama korunur)", () => {
    const g = gelirTablosu(donem, [ayse, { salary: null, status: 'Ayrıldı' }], YIL, AY);
    expect(g.personel).toEqual({ toplam: 30000, bilinen: 1, bilinmeyen: 0 });
  });
  it('personel listesi yoksa gider gerçek 0', () => {
    for (const p of [undefined, null, []]) {
      const g = gelirTablosu(donem, p, YIL, AY);
      expect(g.personel).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
      expect(g.faaliyetKari).toBe(9500);
    }
  });
});

describe('gelirTablosu — vergi öncesi (VIII) ve net dönem kârı (IX)', () => {
  it('kâr varsa %20 kurumlar vergisi karşılığı; zararda karşılık gerçek 0', () => {
    expect(VERGI_ORANI).toBe(0.2);
    const karli = gelirTablosu(donem, [{ salary: 2000, status: 'Aktif' }], YIL, AY); // faaliyet kârı 7500
    expect(karli.faaliyetKari).toBe(7500);
    expect(karli.finansmanGideri).toBe(0);
    expect(karli.diger).toBe(0);
    expect(karli.vergiOncesiKar).toBe(7500);
    expect(karli.vergiKarsiligi).toBe(1500);
    expect(karli.netDonemKari).toBe(6000);
    const zararli = gelirTablosu(donem, personel, YIL, AY);
    expect(zararli.vergiKarsiligi).toBe(0);
    expect(zararli.netDonemKari).toBe(-45500);
  });
  it('vergi öncesi kâr bilinmiyorsa karşılık ₺0 DEĞİL bilinmiyor (eski `> 0 ? … : 0` NaN için 0 basıyordu)', () => {
    const g = gelirTablosu(donem, [{ salary: null, status: 'Aktif' }], YIL, AY);
    expect(g.vergiOncesiKar).toBeNaN();
    expect(g.vergiKarsiligi).toBeNaN();
    expect(g.netDonemKari).toBeNaN();
  });
});

describe('gelirTablosu — boş dönem ve sayfa paritesi', () => {
  it('boş dönem GERÇEK 0 (hareketsiz ay): tutarlar 0, marjlar null, ekran 0 (— değil)', () => {
    const g = gelirTablosu([temmuz, tarihsiz], personel, YIL, AY);
    expect(g.siparisSayisi).toBe(0);
    expect(g.brutSatis).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(ekranTutari(g.brutSatis)).toBe(0);
    expect(g.netSatis).toBe(0);
    expect(g.smm.toplam).toBe(0);
    expect(g.brutKar).toBe(0);
    expect(g.brutKarMarji).toBeNull();
    expect(g.faaliyetKari).toBe(-55000);
    expect(g.faaliyetKarMarji).toBeNull();
    expect(g.vergiKarsiligi).toBe(0);
    expect(g.netDonemKari).toBe(-55000);
  });
  it('tamamen bilinen veride eski kodla (GelirTablosuTab 29-69) BİREBİR aynı sayılar', () => {
    // Eski parse Timestamp'i çözemediğinden karşılaştırma Date/ISO tarihli siparişlerle.
    const eskiUyumlu = [sirin, iptalYapi, gunluk, temmuz, tarihsiz];
    for (const p of [personel, [{ salary: 2000, status: 'Aktif' }]]) {
      const eski = eskiGelirTablosu(eskiUyumlu, p, YIL, AY);
      const yeni = gelirTablosu(eskiUyumlu, p, YIL, AY);
      expect(yeni.siparisSayisi).toBe(eski.periodOrders.length);
      expect(yeni.brutSatis.toplam).toBe(eski.brutSatislar);
      expect(yeni.iade.toplam).toBe(eski.satisIadeleri);
      expect(yeni.netSatis).toBe(eski.netSatislar);
      expect(yeni.smm.toplam).toBe(eski.satislarinMaliyeti);
      expect(yeni.brutKar).toBe(eski.brutKar);
      expect(yeni.brutKarMarji).toBeCloseTo(eski.brutKarMarji, 9);
      expect(yeni.personel.toplam).toBe(eski.personelGiderleri);
      expect(yeni.faaliyetKari).toBe(eski.faaliyetKari);
      expect(yeni.faaliyetKarMarji).toBeCloseTo(eski.faaliyetKarMarji, 9);
      expect(yeni.vergiOncesiKar).toBe(eski.vergionceKar);
      expect(yeni.vergiKarsiligi).toBe(eski.vergiKarsiligi);
      expect(yeni.netDonemKari).toBe(eski.netDonemKari);
    }
  });
  it('girdiyi değiştirmez', () => {
    const kopya = JSON.parse(JSON.stringify([sirin, iptalYapi]));
    gelirTablosu([sirin, iptalYapi], personel, YIL, AY);
    expect(JSON.parse(JSON.stringify([sirin, iptalYapi]))).toEqual(kopya);
  });
});
