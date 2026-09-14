/**
 * bankaMutabakat.test.ts — Muhasebe → Banka sekmesi hesap sözleşmesi (Faz 3 1/n, 2026-09-13).
 * ÖNCE YAZILDI. Kapsam: Phase 118 Banka Mutabakatı + Phase 638 Otomatik Ödeme Eşleştirme.
 *
 * Sayfadaki sahte kesinlik siteleri (MuhasebePage.tsx ~814 / ~820 / ~865 / ~998 / ~1002):
 *   - `bookReceipts = reduce(s + (o.totalPrice || 0))`  → tutarı bilinmeyen tahsilat ₺0 sayılıyordu
 *   - `reduce(s + po.totalAmount)` (totalAmount opsiyonel) → undefined toplamı NaN'a çeviriyordu
 *   - `setBankBalance(Number(draft) || 0)`               → boş/bozuk giriş "banka bakiyesi ₺0" oluyordu
 *   - `invoiceAmount: o.totalPrice || 0` + `(o.totalPrice||0) === inv.invoiceAmount`
 *                                                        → iki bilinmeyen 0===0 ile "Tam %100" oluyordu
 * Kural (CLAUDE.md + Faz 1): bilinmeyen tutar 0 değil BİLİNMİYOR — toplama girmez, SAYILIR;
 * bilinmeyeni YA DA tarihsiz kaydı olan dönemde "Mutabık / Fark Var" hükmü verilmez (null).
 */
import { describe, it, expect } from 'vitest';
import {
  bankaMutabakati, bankaBakiyesiOku, odenmemisFaturalar, odemeEslestir, eslestirmeOzeti, tutariBilinmeyenFaturaSayisi,
  type MutabakatSiparisi, type MutabakatAlisSiparisi, type EslestirmeSiparisi,
} from './bankaMutabakat';

// ── Phase 118: Banka Mutabakatı ──────────────────────────────────────────────────────────

const DONEM = '2026-09';

const siparisler: MutabakatSiparisi[] = [
  { totalPrice: 1000,   paid: true,  status: 'Delivered', source: 'shopify', createdAt: '2026-09-03T10:00:00Z' },
  { totalPrice: 2500,   paid: true,  status: 'Delivered', source: 'cetpa',   createdAt: '2026-09-21T08:30:00Z' },
  { totalPrice: 9999,   paid: true,  status: 'Delivered', source: 'cetpa',   createdAt: '2026-08-30T23:00:00Z' }, // önceki ay
  { totalPrice: 4000,   paid: false, status: 'Pending',   source: 'cetpa',   createdAt: '2026-09-10T09:00:00Z' }, // ödenmemiş
];
const alisSiparisleri: MutabakatAlisSiparisi[] = [
  { totalAmount: 800,  status: 'Onaylandı',    createdAt: '2026-09-05' },
  { totalAmount: 300,  status: 'Teslim Alındı', createdAt: '2026-09-06' }, // kapanmış → dışarıda
  { totalAmount: 500,  status: 'İptal Edildi',  createdAt: '2026-09-07' }, // iptal → dışarıda
  { totalAmount: 700,  status: 'Onaylandı',    createdAt: '2026-08-15' }, // önceki ay
];

describe('bankaMutabakati — Phase 118 Banka Mutabakatı', () => {
  it('dönemdeki ödenmiş tahsilatı ve açık alış siparişlerini toplar; hesaplanan bakiye + fark sayfadaki formülle', () => {
    const r = bankaMutabakati({ siparisler, alisSiparisleri, donem: DONEM, bankaBakiyesi: 10000 });
    expect(r.tahsilat).toEqual({ toplam: 3500, bilinen: 2, bilinmeyen: 0 });
    expect(r.acikAlis).toEqual({ toplam: 800, bilinen: 1, bilinmeyen: 0 });
    expect(r.hesaplananBakiye).toBe(10000 + 3500 - 800);
    expect(r.fark).toBe(10000 - (10000 + 3500 - 800));
    expect(r.mutabik).toBe(false);
    expect(r.bilinmeyen).toBe(0);
    expect(r.tarihsiz).toBe(0);
  });

  it('|fark| < eşik (varsayılan 1000) ise mutabık', () => {
    const r = bankaMutabakati({
      siparisler: [{ totalPrice: 600, paid: true, source: 'cetpa', createdAt: '2026-09-02' }],
      alisSiparisleri: [{ totalAmount: 100, status: 'Onaylandı', createdAt: '2026-09-02' }],
      donem: DONEM, bankaBakiyesi: 5000,
    });
    expect(r.fark).toBe(-500);
    expect(r.mutabik).toBe(true);
    expect(bankaMutabakati({ siparisler: [], alisSiparisleri: [], donem: DONEM, bankaBakiyesi: 5000, esik: 0.5 }).mutabik).toBe(true);
  });

  it("bilinmeyen tutar (undefined/null/''/NaN/'abc') 0 SAYILMAZ: toplama girmez, `bilinmeyen` sayılır, hüküm verilmez", () => {
    const bozuk: MutabakatSiparisi[] = [
      { totalPrice: 1000,      paid: true, source: 'cetpa', createdAt: '2026-09-01' },
      { totalPrice: undefined, paid: true, source: 'cetpa', createdAt: '2026-09-02' },
      { totalPrice: null,      paid: true, source: 'cetpa', createdAt: '2026-09-03' },
      { totalPrice: '',        paid: true, source: 'cetpa', createdAt: '2026-09-04' },
      { totalPrice: NaN,       paid: true, source: 'cetpa', createdAt: '2026-09-05' },
      { totalPrice: 'abc',     paid: true, source: 'cetpa', createdAt: '2026-09-06' },
    ];
    const r = bankaMutabakati({
      siparisler: bozuk,
      alisSiparisleri: [{ totalAmount: undefined, status: 'Onaylandı', createdAt: '2026-09-02' }, { totalAmount: 200, status: 'Onaylandı', createdAt: '2026-09-03' }],
      donem: DONEM, bankaBakiyesi: 10000,
    });
    expect(r.tahsilat).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 5 });
    expect(r.acikAlis).toEqual({ toplam: 200, bilinen: 1, bilinmeyen: 1 });
    expect(r.bilinmeyen).toBe(6);
    expect(r.hesaplananBakiye).toBeNaN();                    // kısmi tahsilattan bakiye TÜRETİLMEZ ('—'); satırlar kısmi + "6 kayıt tutarsız" notu
    expect(r.fark).toBeNaN();
    expect(r.mutabik).toBeNull();                            // "✓ Mutabık" rozeti verilmez
  });

  it("sayısal string kabul (DB'den '1250.5' gelebilir)", () => {
    const r = bankaMutabakati({
      siparisler: [{ totalPrice: '1250.5', paid: true, source: 'cetpa', createdAt: '2026-09-02' }],
      alisSiparisleri: [{ totalAmount: '99.5', status: 'Onaylandı', createdAt: '2026-09-02' }],
      donem: DONEM, bankaBakiyesi: 0,
    });
    expect(r.tahsilat.toplam).toBe(1250.5);
    expect(r.acikAlis.toplam).toBe(99.5);
  });

  it('Mikro kaynaklı kayıtta `paid` anlamsız — paid:true olsa bile tahsilata girmez (odemeTakipli)', () => {
    const r = bankaMutabakati({
      siparisler: [
        { totalPrice: 5000, paid: true, source: 'mikro-fatura',   createdAt: '2026-09-02' },
        { totalPrice: 7000, paid: true, source: 'mikro-siparis',  createdAt: '2026-09-03' },
        { totalPrice: 100,  paid: true, source: 'cetpa',          createdAt: '2026-09-04' },
      ],
      alisSiparisleri: [], donem: DONEM, bankaBakiyesi: 0,
    });
    expect(r.tahsilat).toEqual({ toplam: 100, bilinen: 1, bilinmeyen: 0 });
  });

  it('tarih: createdAt yoksa syncedAt; ikisi de çözülemiyorsa döneme konamaz → `tarihsiz` sayılır, toplama girmez, hüküm verilmez', () => {
    const r = bankaMutabakati({
      siparisler: [
        { totalPrice: 100, paid: true, source: 'cetpa', syncedAt: '2026-09-11T00:00:00Z' },
        { totalPrice: 200, paid: true, source: 'cetpa' },
        { totalPrice: 300, paid: true, source: 'cetpa', createdAt: 'dün' },
        { totalPrice: 400, paid: true, source: 'cetpa', createdAt: new Date('2026-09-12T12:00:00Z') },
      ],
      alisSiparisleri: [{ totalAmount: 50, status: 'Onaylandı' }],
      donem: DONEM, bankaBakiyesi: 0,
    });
    expect(r.tahsilat.toplam).toBe(500);
    expect(r.acikAlis.toplam).toBe(0);
    expect(r.tarihsiz).toBe(3);
    // Tutarların hepsi bilinen (bilinmeyen 0), bakiye girili — yalnız tarihsiz kayıt var. O kayıt bu döneme
    // ait olabilir: rozet "✓ Mutabık" basarken not "hüküm verilemedi" diyemez → hüküm null (hakem, 2026-09-13).
    expect(r.bilinmeyen).toBe(0);
    expect(r.mutabik).toBeNull();
  });

  it('banka bakiyesi bilinmiyorsa hesaplanan bakiye ve fark NaN, hüküm null; toplamlar yine hesaplanır', () => {
    for (const bakiye of [NaN, undefined, '', 'abc', null]) {
      const r = bankaMutabakati({ siparisler, alisSiparisleri, donem: DONEM, bankaBakiyesi: bakiye });
      expect(r.tahsilat.toplam).toBe(3500);
      expect(Number.isNaN(r.hesaplananBakiye)).toBe(true);
      expect(Number.isNaN(r.fark)).toBe(true);
      expect(r.mutabik).toBeNull();
    }
  });

  it('boş listeler: toplamlar 0, hesaplanan = bakiye, fark 0, mutabık', () => {
    const r = bankaMutabakati({ siparisler: [], alisSiparisleri: [], donem: DONEM, bankaBakiyesi: 12000 });
    expect(r.tahsilat).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(r.acikAlis).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(r.hesaplananBakiye).toBe(12000);
    expect(r.fark).toBe(0);
    expect(r.mutabik).toBe(true);
  });
});

describe('bankaBakiyesiOku — ekstre bakiyesi girişi (~865 `Number(draft) || 0`)', () => {
  it("boş/bozuk giriş 0 DEĞİL bilinmiyor (NaN)", () => {
    for (const v of ['', '   ', 'abc', undefined, null, NaN]) expect(Number.isNaN(bankaBakiyesiOku(v))).toBe(true);
  });
  it('gerçek sayı olduğu gibi; 0 ve eksi (kredili mevduat) gerçek değerdir', () => {
    expect(bankaBakiyesiOku('12500')).toBe(12500);
    expect(bankaBakiyesiOku('12500.75')).toBe(12500.75);
    expect(bankaBakiyesiOku('0')).toBe(0);
    expect(bankaBakiyesiOku('-300')).toBe(-300);
    expect(bankaBakiyesiOku(42)).toBe(42);
  });
});

// ── Phase 638: Otomatik Ödeme Eşleştirme ─────────────────────────────────────────────────

const yildiz = 'Yıldız İnşaat', sahin = 'Şahin Yapı', celik = 'Çelik Hırdavat';
const eslestirmeVerisi: EslestirmeSiparisi[] = [
  { id: 'SAS-000101', customerName: yildiz, totalPrice: 1500, paid: false, status: 'Pending',   source: 'cetpa' },
  { id: 'SAS-000102', customerName: yildiz, totalPrice: 1500, paid: true,  status: 'Delivered', source: 'cetpa' },
  { id: 'SAS-000103', customerName: sahin,  totalPrice: 2000, paid: false, status: 'Pending',   source: 'shopify' },
  { id: 'SAS-000104', customerName: sahin,  totalPrice: 999,  paid: true,  status: 'Delivered', source: 'cetpa' },
  { id: 'SAS-000105', customerName: celik,  totalPrice: 700,  paid: false, status: 'Pending',   source: 'cetpa' },
  { id: 'SAS-000106', customerName: celik,  totalPrice: 700,  paid: false, status: 'Cancelled', source: 'cetpa' }, // iptal → dışarıda
  { id: 'MF-A00001',  customerName: celik,  totalPrice: 700,  paid: false, status: 'Pending',   source: 'mikro-fatura' }, // Mikro → dışarıda
];

describe('odenmemisFaturalar — eşleştirme adayı faturalar', () => {
  it('ödenmemiş + iptal olmayan + ödemesi Cetpa\'da izlenen (Mikro kaynaklı DEĞİL)', () => {
    expect(odenmemisFaturalar(eslestirmeVerisi).map(o => o.id)).toEqual(['SAS-000101', 'SAS-000103', 'SAS-000105']);
  });
  it('paid alanı hiç yoksa (Cetpa kaynaklı) ödenmemiş sayılır — sayfadaki `!o.paid` gibi', () => {
    expect(odenmemisFaturalar([{ id: 'X1', source: 'cetpa', totalPrice: 10 }])).toHaveLength(1);
  });
  it('boş liste → boş', () => { expect(odenmemisFaturalar([])).toEqual([]); });
});

describe('odemeEslestir — Phase 638', () => {
  it('sayfadaki puanlama: aynı tutarlı ödenmiş sipariş → Tam %100; müşterinin başka ödemesi → Kısmi %80 (%80 tutar); hiç yok → Eşleşmedi %60', () => {
    const { sonuclar, bilinmeyen } = odemeEslestir(eslestirmeVerisi);
    expect(bilinmeyen).toBe(0);
    expect(sonuclar).toEqual([
      { invoiceId: 'SAS-000101', invoiceNo: 'INV-000101', customer: yildiz, invoiceAmount: 1500, matchedAmount: 1500, confidence: 100, status: 'Tam' },
      { invoiceId: 'SAS-000103', invoiceNo: 'INV-000103', customer: sahin,  invoiceAmount: 2000, matchedAmount: 1600, confidence: 80,  status: 'Kısmi' },
      { invoiceId: 'SAS-000105', invoiceNo: 'INV-000105', customer: celik,  invoiceAmount: 700,  matchedAmount: 0,    confidence: 60,  status: 'Eşleşmedi' },
    ]);
  });

  it("tutarı bilinmeyen fatura eşleştirilMEZ: sonuçlara girmez, `bilinmeyen` sayılır (eskiden 0===0 ile 'Tam %100')", () => {
    const { sonuclar, bilinmeyen } = odemeEslestir([
      { id: 'SAS-000201', customerName: yildiz, totalPrice: undefined, paid: false, source: 'cetpa' },
      { id: 'SAS-000202', customerName: yildiz, totalPrice: undefined, paid: true,  source: 'cetpa' },
      { id: 'SAS-000203', customerName: sahin,  totalPrice: '',        paid: false, source: 'cetpa' },
      { id: 'SAS-000204', customerName: sahin,  totalPrice: NaN,       paid: false, source: 'cetpa' },
    ]);
    expect(sonuclar).toEqual([]);
    expect(bilinmeyen).toBe(3);
  });

  it('tutarı bilinmeyen ÖDENMİŞ sipariş tam eşleşme sayılmaz (ama müşterinin ödemesi var → Kısmi)', () => {
    const { sonuclar } = odemeEslestir([
      { id: 'SAS-000301', customerName: yildiz, totalPrice: 1500,      paid: false, source: 'cetpa' },
      { id: 'SAS-000302', customerName: yildiz, totalPrice: undefined, paid: true,  source: 'cetpa' },
      { id: 'SAS-000303', customerName: yildiz, totalPrice: 'abc',     paid: true,  source: 'cetpa' },
    ]);
    expect(sonuclar[0]?.status).toBe('Kısmi');
    expect(sonuclar[0]?.confidence).toBe(80);
  });

  it("sayısal string tutar eşleşir (DB '1500' vs 1500)", () => {
    const { sonuclar } = odemeEslestir([
      { id: 'SAS-000401', customerName: yildiz, totalPrice: '1500', paid: false, source: 'cetpa' },
      { id: 'SAS-000402', customerName: yildiz, totalPrice: 1500,   paid: true,  source: 'cetpa' },
    ]);
    expect(sonuclar[0]?.status).toBe('Tam');
    expect(sonuclar[0]?.invoiceAmount).toBe(1500);
  });

  it("müşteri adı boşsa aday aranmaz — '' === '' ile sahte eşleşme yok; ad boşluk farkıyla eşleşir", () => {
    const { sonuclar } = odemeEslestir([
      { id: 'SAS-000501', customerName: '',        totalPrice: 100, paid: false, source: 'cetpa' },
      { id: 'SAS-000502', customerName: undefined, totalPrice: 100, paid: true,  source: 'cetpa' },
      { id: 'SAS-000503', customerName: ' Yıldız İnşaat ', totalPrice: 250, paid: false, source: 'cetpa' },
      { id: 'SAS-000504', customerName: yildiz,   totalPrice: 250, paid: true,  source: 'cetpa' },
    ]);
    expect(sonuclar.find(s => s.invoiceId === 'SAS-000501')?.status).toBe('Eşleşmedi');
    expect(sonuclar.find(s => s.invoiceId === 'SAS-000503')?.status).toBe('Tam');
    expect(sonuclar.find(s => s.invoiceId === 'SAS-000503')?.customer).toBe(yildiz);
  });

  it('Mikro kaynaklı ödenmiş kayıt aday DEĞİL (paid alanı orada anlamsız)', () => {
    const { sonuclar } = odemeEslestir([
      { id: 'SAS-000601', customerName: yildiz, totalPrice: 1500, paid: false, source: 'cetpa' },
      { id: 'MF-A00002',  customerName: yildiz, totalPrice: 1500, paid: true,  source: 'mikro-fatura' },
    ]);
    expect(sonuclar[0]?.status).toBe('Eşleşmedi');
  });

  it('boş liste → { sonuclar: [], bilinmeyen: 0 }', () => {
    expect(odemeEslestir([])).toEqual({ sonuclar: [], bilinmeyen: 0 });
  });
});

describe('eslestirmeOzeti — kart sayaçları', () => {
  it('Tam / Kısmi / Eşleşmedi sayar; boşta sıfırlar', () => {
    const { sonuclar } = odemeEslestir(eslestirmeVerisi);
    expect(eslestirmeOzeti(sonuclar)).toEqual({ tam: 1, kismi: 1, eslesmedi: 1 });
    expect(eslestirmeOzeti([])).toEqual({ tam: 0, kismi: 0, eslesmedi: 0 });
  });
});

describe('tutariBilinmeyenFaturaSayisi — "N faturanın tutarı bilinmiyor" notu', () => {
  it('yalnız aday (ödenmemiş, iptalsiz, takipli) faturalardan tutarı bilinmeyenleri sayar; odemeEslestir.bilinmeyen ile tutarlı', () => {
    const veri: EslestirmeSiparisi[] = [
      { id: 'SAS-000701', customerName: yildiz, totalPrice: undefined, paid: false, source: 'cetpa' },
      { id: 'SAS-000702', customerName: sahin,  totalPrice: '',        paid: false, source: 'cetpa' },
      { id: 'SAS-000703', customerName: celik,  totalPrice: 700,       paid: false, source: 'cetpa' },
      { id: 'SAS-000704', customerName: celik,  totalPrice: undefined, paid: false, status: 'Cancelled', source: 'cetpa' }, // iptal → sayılmaz
      { id: 'MF-A00003',  customerName: celik,  totalPrice: undefined, paid: false, source: 'mikro-fatura' },              // Mikro → sayılmaz
      { id: 'SAS-000705', customerName: celik,  totalPrice: undefined, paid: true,  source: 'cetpa' },                     // ödenmiş → aday değil
    ];
    expect(tutariBilinmeyenFaturaSayisi(veri)).toBe(2);
    expect(tutariBilinmeyenFaturaSayisi(veri)).toBe(odemeEslestir(veri).bilinmeyen);
    expect(tutariBilinmeyenFaturaSayisi([])).toBe(0);
  });
});
