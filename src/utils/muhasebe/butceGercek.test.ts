/**
 * butceGercek.test.ts — Muhasebe → Bütçe (Phase 113 "Budget vs Actuals") hesap sözleşmesi.
 * Faz 3 1/n (2026-09-13). ÖNCE YAZILDI — modül yokken kırmızı görüldü.
 *
 * Sayfadaki sahte kesinlik siteleri (MuhasebePage.tsx ~652-801):
 *   - `totalMonthRevenue = reduce(s + (o.totalPrice || 0))` → tutarı bilinmeyen sipariş 0 sayılıyordu
 *   - `getBudget = budgets.find(...)?.budgetTRY || 0`       → okunamayan bütçe kalemi 0 oluyordu
 *   - `totalActual = reduce(s + (actualSplit[key] || 0))`   → payı olmayan bölüm 0 sayılıyordu
 *   - `pct = budget > 0 ? round(...) : 0`                  → bütçesi olmayan bölüm "%0" gösteriyordu
 * Kural (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR, ekranda '—'.
 */
import { describe, it, expect } from 'vitest';
import { tlYaz } from '../currency';
import {
  GERCEKLESEN_PAYLARI,
  ayinSiparisleri,
  aylikCiro,
  gerceklesenDagilimi,
  butceTutari,
  butceKullanimi,
  butceGercekOzeti,
} from './butceGercek';

const AY = '2026-09';
const eylul = (gun: number) => new Date(2026, 8, gun, 10, 30); // yerel saat, 0-tabanlı ay → Eylül
const agustos = (gun: number) => new Date(2026, 7, gun, 9, 0);

describe('ayinSiparisleri — ay süzgeci (sayfa paritesi: createdAt ?? syncedAt)', () => {
  it('createdAt seçili ayda → dahil; başka ayda → hariç', () => {
    const s = [
      { id: 'sip-1', customerName: 'Şişli İnşaat', totalPrice: 1000, createdAt: eylul(5) },
      { id: 'sip-2', customerName: 'Çankaya Yapı', totalPrice: 2000, createdAt: agustos(28) },
    ];
    expect(ayinSiparisleri(s, AY).map(o => o.id)).toEqual(['sip-1']);
  });
  it('createdAt yoksa ya da null ise syncedAt kullanılır (`??` paritesi)', () => {
    const s = [
      { id: 'shopify-1', totalPrice: 500, syncedAt: eylul(12) },
      { id: 'shopify-2', totalPrice: 500, createdAt: null, syncedAt: eylul(13) },
      { id: 'shopify-3', totalPrice: 500, createdAt: agustos(1), syncedAt: eylul(14) }, // createdAt VAR → o kazanır
    ];
    expect(ayinSiparisleri(s, AY).map(o => o.id)).toEqual(['shopify-1', 'shopify-2']);
  });
  it('ISO metin tarih de çözülür; tarihi çözülemeyen (yok / "abc" / "") hiçbir aya girmez', () => {
    const s = [
      { id: 'iso', totalPrice: 1, createdAt: '2026-09-20T08:00:00' },
      { id: 'tarihsiz', totalPrice: 1 },
      { id: 'bozuk', totalPrice: 1, createdAt: 'abc' },
      { id: 'bos', totalPrice: 1, createdAt: '', syncedAt: '' },
    ];
    expect(ayinSiparisleri(s, AY).map(o => o.id)).toEqual(['iso']);
  });
  it('ay anahtarı boşsa (ay seçici temizlenmiş) hiçbir sipariş eşleşmez', () => {
    expect(ayinSiparisleri([{ totalPrice: 1, createdAt: eylul(1) }], '')).toEqual([]);
  });
  it('SAYFA PARİTESİ: durum/kaynak süzgeci uygulanmaz — iptal ve Mikro kaynaklı kayıtlar da ayın siparişidir', () => {
    // Sayfada da böyleydi; değiştirmek ayrı bir ürün kararı (bağlama notunda işaretli).
    const s = [
      { id: 'iptal', totalPrice: 100, status: 'Cancelled', createdAt: eylul(2) },
      { id: 'mikro', totalPrice: 100, source: 'mikro-fatura', createdAt: eylul(3) },
    ];
    expect(ayinSiparisleri(s, AY)).toHaveLength(2);
  });
});

describe('aylikCiro — ayın toplam sipariş tutarı', () => {
  it('bilinen tutarlar toplanır; sayısal metin (DB "750") kabul', () => {
    const s = [
      { customerName: 'Işık Beton', totalPrice: 1500.5, createdAt: eylul(1) },
      { customerName: 'Güneş Çimento', totalPrice: 2000, createdAt: eylul(2) },
      { customerName: 'Öztürk Hırdavat', totalPrice: '750', createdAt: eylul(3) },
    ];
    expect(aylikCiro(s, AY)).toEqual({ toplam: 4250.5, bilinen: 3, bilinmeyen: 0 });
  });
  it("bilinmeyen tutar (undefined/null/''/NaN/'abc') 0 SAYILMAZ — toplama girmez, sayılır", () => {
    const s = [
      { totalPrice: 1000, createdAt: eylul(1) },
      { totalPrice: undefined, createdAt: eylul(2) },
      { totalPrice: null, createdAt: eylul(3) },
      { totalPrice: '', createdAt: eylul(4) },
      { totalPrice: NaN, createdAt: eylul(5) },
      { totalPrice: 'abc', createdAt: eylul(6) },
    ];
    expect(aylikCiro(s, AY)).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 5 });
  });
  it('gerçek 0 tutarlı sipariş bilinendir (ücretsiz numune)', () => {
    expect(aylikCiro([{ totalPrice: 0, createdAt: eylul(9) }], AY)).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
  });
  it('boş liste → 0 / 0 / 0', () => {
    expect(aylikCiro([], AY)).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
  it('ay dışı siparişin bilinmeyen tutarı bile bu ayı ilgilendirmez', () => {
    expect(aylikCiro([{ totalPrice: undefined, createdAt: agustos(30) }], AY)).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('gerceklesenDagilimi — ciroyu sabit paylarla bölümlere dağıtır (sezgisel; sayfa notunda yazılı)', () => {
  it('100.000 ₺ ciro → satış 12.000, pazarlama 6.000, operasyon 10.000, İK 8.000, IT 3.000, genel 5.000', () => {
    const d = gerceklesenDagilimi(100_000);
    expect(d.satis).toBeCloseTo(12_000, 6);
    expect(d.pazarlama).toBeCloseTo(6_000, 6);
    expect(d.operasyon).toBeCloseTo(10_000, 6);
    expect(d.ik).toBeCloseTo(8_000, 6);
    expect(d.it).toBeCloseTo(3_000, 6);
    expect(d.genel).toBeCloseTo(5_000, 6);
  });
  it('payların toplamı %44 (sayfadaki sabitlerle birebir)', () => {
    const toplamPay = Object.values(GERCEKLESEN_PAYLARI).reduce((s, p) => s + p, 0);
    expect(toplamPay).toBeCloseTo(0.44, 9);
  });
  it('ciro bilinmiyorsa (NaN) her bölüm NaN — 0 değil', () => {
    for (const v of Object.values(gerceklesenDagilimi(NaN))) expect(Number.isNaN(v)).toBe(true);
  });
  it('payı tanımlı olmayan bölüm dağılımda yer almaz (eski `actualSplit[key] || 0` onu 0 sayıyordu)', () => {
    expect('hukuk' in gerceklesenDagilimi(1000)).toBe(false);
  });
});

describe('butceTutari — bölümün bütçesi', () => {
  const kalemler = [
    { dept: 'satis', budgetTRY: 15_000 },
    { dept: 'ik', budgetTRY: '5000' },
    { dept: 'pazarlama', budgetTRY: undefined },
    { dept: 'operasyon', budgetTRY: NaN },
    { dept: 'it', budgetTRY: '' },
  ];
  it('kalem var ve sayı → değer; sayısal metin kabul', () => {
    expect(butceTutari(kalemler, 'satis')).toBe(15_000);
    expect(butceTutari(kalemler, 'ik')).toBe(5000);
  });
  it('kalem YOK → 0: kullanıcı bütçe girmemiş (sayfa 0 girişini kaydı silerek saklar) — gerçek sıfır', () => {
    expect(butceTutari(kalemler, 'genel')).toBe(0);
    expect(butceTutari([], 'satis')).toBe(0);
  });
  it("kalem var ama değeri okunamıyor (undefined/NaN/'') → NaN; eski `|| 0` bunu 0 gösteriyordu", () => {
    expect(Number.isNaN(butceTutari(kalemler, 'pazarlama'))).toBe(true);
    expect(Number.isNaN(butceTutari(kalemler, 'operasyon'))).toBe(true);
    expect(Number.isNaN(butceTutari(kalemler, 'it'))).toBe(true);
  });
});

describe('butceKullanimi — oran / aşım', () => {
  it('12.000 gerçekleşen, 10.000 bütçe → %120, aşım 2.000', () => {
    expect(butceKullanimi(10_000, 12_000)).toEqual({ oran: 120, asim: true, asimTutari: 2000 });
  });
  it('8.000 / 10.000 → %80, aşım yok (asimTutari null — sayfa yalnız aşımda gösterir)', () => {
    expect(butceKullanimi(10_000, 8_000)).toEqual({ oran: 80, asim: false, asimTutari: null });
  });
  it('yuvarlama: 1/3 → 33', () => {
    expect(butceKullanimi(3, 1).oran).toBe(33);
  });
  it('bütçe 0 (girilmemiş) → oran null — eski kod "%0" basıyordu, sahte kesinlik', () => {
    expect(butceKullanimi(0, 5000)).toEqual({ oran: null, asim: false, asimTutari: null });
  });
  it('bütçe bilinmiyor (NaN) ya da gerçekleşen bilinmiyor → oran null, aşım iddiası yok', () => {
    expect(butceKullanimi(NaN, 5000)).toEqual({ oran: null, asim: false, asimTutari: null });
    expect(butceKullanimi(5000, NaN)).toEqual({ oran: null, asim: false, asimTutari: null });
  });
});

describe('butceGercekOzeti — panelin tamamı tek çağrıda', () => {
  const siparisler = [
    { id: 'S-1', customerName: 'Şişli İnşaat', totalPrice: 60_000, createdAt: eylul(3) },
    { id: 'S-2', customerName: 'Çankaya Yapı', totalPrice: 40_000, createdAt: eylul(8) },
    { id: 'S-3', customerName: 'Işık Beton', totalPrice: undefined, createdAt: eylul(9) }, // tutarı bilinmiyor
    { id: 'S-4', customerName: 'Ağustos Müşterisi', totalPrice: 999_999, createdAt: agustos(31) }, // ay dışı
  ];
  const kalemler = [
    { dept: 'satis', budgetTRY: 15_000 },
    { dept: 'ik', budgetTRY: 5_000 },
    { dept: 'pazarlama', budgetTRY: undefined }, // bozuk kayıt
  ];
  const ozet = butceGercekOzeti(siparisler, kalemler, AY);

  it('ciro: ayın bilinen tutarları toplanır, bilinmeyen sayılır, ay dışı yok', () => {
    expect(ozet.ciro).toEqual({ toplam: 100_000, bilinen: 2, bilinmeyen: 1 });
  });
  it('bütçe toplamı: bilinenler toplanır (15.000 + 5.000), bozuk kalem sayılır', () => {
    expect(ozet.butce).toEqual({ toplam: 20_000, bilinmeyen: 1 });
  });
  it('gerçekleşen toplamı: ciro × Σpay (%44); bilinmeyen sipariş sayısı taşınır; payı olmayan bölüm yok', () => {
    expect(ozet.gerceklesen.toplam).toBeCloseTo(44_000, 6);
    expect(ozet.gerceklesen.bilinmeyen).toBe(1);
    expect(ozet.gerceklesen.paysizBolum).toBe(0);
  });
  it('satırlar: satış 12.000/15.000 → %80; İK 8.000/5.000 → %160 aşım 3.000; genel bütçesiz → oran null', () => {
    expect(ozet.satirlar.satis).toMatchObject({ butce: 15_000, oran: 80, asim: false, asimTutari: null });
    expect(ozet.satirlar.satis.gerceklesen).toBeCloseTo(12_000, 6);
    expect(ozet.satirlar.ik).toMatchObject({ butce: 5_000, oran: 160, asim: true });
    expect(ozet.satirlar.ik.asimTutari).toBeCloseTo(3_000, 6);
    expect(ozet.satirlar.genel).toMatchObject({ butce: 0, oran: null, asim: false, asimTutari: null });
  });
  it('bozuk bütçe kalemi olan bölüm: bütçe NaN, oran null — ekranda "—" (paraYaz NaN → "—")', () => {
    expect(Number.isNaN(ozet.satirlar.pazarlama.butce)).toBe(true);
    expect(ozet.satirlar.pazarlama.oran).toBeNull();
    expect(ozet.satirlar.pazarlama.asim).toBe(false);
  });
  it('bölüm listesi sayfadan verilir; payı olmayan bölüm gerçekleşende NaN ve paysizBolum sayılır', () => {
    const o = butceGercekOzeti(siparisler, kalemler, AY, ['satis', 'hukuk']);
    expect(Number.isNaN(o.satirlar.hukuk.gerceklesen)).toBe(true);
    expect(o.gerceklesen.paysizBolum).toBe(1);
    expect(o.gerceklesen.toplam).toBeCloseTo(12_000, 6);
    expect(Object.keys(o.satirlar)).toEqual(['satis', 'hukuk']);
  });
  it('boş: sipariş ve bütçe yok → her şey 0 / bilinmeyen 0 / oranlar null', () => {
    const o = butceGercekOzeti([], [], AY);
    expect(o.ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(o.butce).toEqual({ toplam: 0, bilinmeyen: 0 });
    expect(o.gerceklesen).toEqual({ toplam: 0, bilinmeyen: 0, paysizBolum: 0 });
    for (const k of Object.keys(GERCEKLESEN_PAYLARI)) expect(o.satirlar[k].oran).toBeNull();
  });
  it('kur yoksa döviz gösterimi "—" (panelin fmtButce zinciri: tlYaz → kurCevir null)', () => {
    expect(tlYaz(ozet.butce.toplam, { birim: 'USD', rates: null, ondalik: 0 })).toBe('—');
    expect(tlYaz(ozet.butce.toplam, { birim: 'USD', rates: { USD: 40 }, ondalik: 0 })).toBe('$500');
    expect(tlYaz(ozet.satirlar.pazarlama.butce, { birim: 'TRY', ondalik: 0 })).toBe('—');
  });
  it('ayın TÜM siparişlerinin tutarı bilinmiyor → ciro 0 DEĞİL bilinmiyor: satırlar NaN, oran null, toplam NaN ("—"); "harcama yok" iddiası YOK', () => {
    const tutarsiz = [
      { id: 'T-1', customerName: 'Işık Beton', totalPrice: undefined, createdAt: eylul(2) },
      { id: 'T-2', customerName: 'Şişli İnşaat', totalPrice: 'abc', createdAt: eylul(4) },
    ];
    const o = butceGercekOzeti(tutarsiz, [{ dept: 'satis', budgetTRY: 15_000 }], AY);
    expect(o.ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
    for (const k of Object.keys(GERCEKLESEN_PAYLARI)) {
      expect(Number.isNaN(o.satirlar[k].gerceklesen)).toBe(true);
      expect(o.satirlar[k]).toMatchObject({ oran: null, asim: false, asimTutari: null }); // eski hâli: "0%" + boş çubuk
    }
    expect(Number.isNaN(o.gerceklesen.toplam)).toBe(true);
    expect(o.gerceklesen.bilinmeyen).toBe(2);   // "2 siparişin tutarı bilinmiyor" notu
    expect(o.gerceklesen.paysizBolum).toBe(0);  // ciro-bilinmiyor NaN'ı paysız bölüm SAYILMAZ
    expect(tlYaz(o.gerceklesen.toplam, { birim: 'TRY', ondalik: 0 })).toBe('—');
  });
  it('gerçek 0 ciro (bilinen 0 ₺ sipariş) bilinmiyor DEĞİLDİR: satırlar 0, oran %0', () => {
    const o = butceGercekOzeti([{ totalPrice: 0, createdAt: eylul(1) }], [{ dept: 'satis', budgetTRY: 100 }], AY);
    expect(o.ciro).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
    expect(o.satirlar.satis).toMatchObject({ gerceklesen: 0, oran: 0, asim: false });
    expect(o.gerceklesen.toplam).toBe(0);
  });
});
