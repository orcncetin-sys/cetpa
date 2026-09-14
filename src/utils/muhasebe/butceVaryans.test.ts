/**
 * butceVaryans.test.ts — MuhasebePage Bütçe vs Gerçekleşen (Phase 580) + KDV Mutabakat (Phase 617)
 * + Gelir/Gider Bütçe (Phase 625) + Varyans Analizi (Phase 634) hesap sözleşmesi.
 * ÖNCE YAZILDI (Faz 3 1/n, 2026-09-13).
 *
 * Sahte-kesinlik siteleri (MuhasebePage.tsx, satırlar yaklaşık):
 *   ~3131 nativeAct      = reduce(o.totalPrice || 0)          tutarı bilinmeyen sipariş 0 ciro sayılıyordu
 *   ~3135 mikroAct       = reduce(f.tutar || 0)               tutarı bilinmeyen fatura 0 ciro
 *   ~3143 budgets580     = reduce(b.budgetTRY || 0)           değeri okunamayan bütçe kalemi 0
 *   ~3147 overallPct     = bud > 0 ? … : 0  (ve ~3187 pct)    bütçesiz ay/yıl "%0 gerçekleşme"
 *   ~3402 faturasizTutar = reduce(Number(totalPrice) || 0)    bilinmeyen 0
 *   ~3403-3405 totalRevenue/Matrah/Kdv düz reduce             NaN yayılır ya da (hook `|| 0`) 0
 *   ~3481/3485 rev/mikroRev reduce(|| 0)                       580 ile aynı kopya
 *   ~3512 bud            = budgetMap[i]?.budgetRevenue || 0   okunamayan bütçe 0
 *   ~3593 actualCogs || revenue*0.48                          SMM bilinmiyorsa cironun %48'i UYDURULUYORDU
 * Kural (CLAUDE.md): bilinmeyen tutar toplama GİRMEZ, SAYILIR (`bilinmeyen`); ekranda '—' + "N kayıt tutarsız".
 * Oran hesaplanamıyorsa null — %0 uydurulmaz. Kur yoksa '—' (kisaTutar/tlYaz zaten null → '—').
 */
import { describe, it, expect } from 'vitest';
import { paraYaz, kisaTutar } from '../currency';
import { ekranTutari } from '../para';
import {
  yillikGerceklesen, yillikButce, fark, gerceklesmeOrani, butceGercekYili,
  kdvMutabakat, kdvBantlari, donemFaturasizSiparisler,
  aylikGelirButcesi, gelirButceYili,
  varyansAylari, varyansAnalizi, VARYANS_VARSAYIMLARI,
} from './butceVaryans';

const SIMDI = new Date(2026, 8, 13, 10, 0, 0); // 13 Eyl 2026 10:00 (yerel)
const t = (y: number, ay: number, g: number) => new Date(y, ay - 1, g, 12);

// ── Ortak veri: 2026 siparişleri + Mikro faturaları ────────────────────────────────────────
const SIPARISLER_2026 = [
  { id: 'S1', customerName: 'Şirin İnşaat', totalPrice: 1000, status: 'Delivered', createdAt: t(2026, 1, 5) },
  { id: 'S2', customerName: 'Çelik Yapı', totalPrice: undefined, status: 'Delivered', createdAt: t(2026, 2, 3) },      // bilinmeyen
  { id: 'S3', customerName: 'Işık Ltd.', totalPrice: 999, status: 'Cancelled', createdAt: t(2026, 1, 6) },             // iptal
  { id: 'S4', customerName: 'Ömer Nakliyat', totalPrice: 500, status: 'Delivered', faturali: true, createdAt: t(2026, 1, 7) }, // Mikro'da sayılır
  { id: 'S5', customerName: 'Güneş A.Ş.', totalPrice: 700, status: 'Delivered', source: 'mikro-fatura', createdAt: t(2026, 1, 8) }, // türetme
  { id: 'S6', customerName: 'Ünal Ticaret', totalPrice: '250.5', status: 'Delivered', createdAt: t(2026, 3, 9) },      // sayısal string
  { id: 'S7', customerName: 'Tarihsiz Müşteri', totalPrice: 123, status: 'Delivered' },                                // tarihi yok
];
const FATURALAR_2026 = [
  { id: 'F1', yon: 'giden', tarih: '2026-01-15', tutar: 2000, matrah: 1666.67, kdv: 333.33, oran: 20, oranKarma: false },
  { id: 'F2', yon: 'gelen', tarih: '2026-01-16', tutar: 3000, matrah: 2500, kdv: 500, oran: 20, oranKarma: false },     // alış
  { id: 'F3', yon: 'giden', tarih: '2025-01-17', tutar: 4000, matrah: 3333, kdv: 667, oran: 20, oranKarma: false },     // başka yıl
  { id: 'F4', yon: 'giden', tarih: '2026-02-18', tutar: NaN, matrah: NaN, kdv: NaN, oran: 20, oranKarma: false },       // bilinmeyen
];

describe('ekran sözleşmesi TEK: para.ekranTutari (butceVaryans kendi kopyasını taşımaz — 2026-09-14)', () => {
  it('hiç bilinen yokken bilinmeyen varsa "—"; bir kayıt bilinip biri bilinmiyorsa KISMİ toplam (+ not sayfada)', () => {
    const g = yillikGerceklesen([...SIPARISLER_2026, { id: 'S8', totalPrice: null, status: 'Delivered', createdAt: t(2026, 1, 9) }], FATURALAR_2026, 2026);
    expect(g[0]).toEqual({ toplam: 3000, bilinen: 2, bilinmeyen: 1 });
    expect(ekranTutari(g[0])).toBe(3000);                       // Kâr/Zarar'daki Ocak ile AYNI sayı
    expect(paraYaz(ekranTutari(g[1]))).toBe('—');               // Şubat: ikisi de bilinmiyor
    expect(kisaTutar(ekranTutari(g[1]), { fmt: 'K' })).toBe('—');
  });
});

describe('yillikGerceklesen — 12 ay, native faturasız + Mikro giden (580/625/634 ortak)', () => {
  const g = yillikGerceklesen(SIPARISLER_2026, FATURALAR_2026, 2026);
  it('12 eleman; Ocak = native 1000 + Mikro 2000; iptal/faturalı/türetme/alış/başka yıl DIŞARIDA', () => {
    expect(g).toHaveLength(12);
    expect(g[0]).toEqual({ toplam: 3000, bilinen: 2, bilinmeyen: 0 });
  });
  it('Şubat: tutarı bilinmeyen sipariş + NaN tutarlı fatura → 0 DEĞİL, bilinmeyen 2', () => {
    expect(g[1]).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
  });
  it("sayısal string '250.5' bilinir; tarihsiz sipariş hiçbir aya girmez", () => {
    expect(g[2]).toEqual({ toplam: 250.5, bilinen: 1, bilinmeyen: 0 });
    expect(g.slice(3).every(a => a.toplam === 0 && a.bilinen === 0 && a.bilinmeyen === 0)).toBe(true);
  });
  it('boş listeler → 12 × {0, 0}', () => {
    expect(yillikGerceklesen([], [], 2026).every(a => a.toplam === 0 && a.bilinen === 0 && a.bilinmeyen === 0)).toBe(true);
  });
});

describe('Phase 580 — yıllık bütçe + fark + gerçekleşme oranı', () => {
  const BUTCELER = {
    '2026-01': [{ dept: 'satis', budgetTRY: 5000 }, { dept: 'ik', budgetTRY: '' }],
    '2026-03': [{ dept: 'satis', budgetTRY: '1500' }],
    '2025-01': [{ dept: 'satis', budgetTRY: 9 }],
  };
  it('yillikButce: değeri okunamayan kalem 0 DEĞİL bilinmeyen; başka yıl/eksik ay {0,0}', () => {
    const b = yillikButce(BUTCELER, 2026);
    expect(b).toHaveLength(12);
    expect(b[0]).toEqual({ toplam: 5000, bilinen: 1, bilinmeyen: 1 });
    expect(b[1]).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(b[2]).toEqual({ toplam: 1500, bilinen: 1, bilinmeyen: 0 });
  });
  it('gerceklesmeOrani: bütçe 0 → null (eski "%0"); bilinmeyen varsa null; normalde yüzde', () => {
    expect(gerceklesmeOrani({ toplam: 900, bilinen: 1, bilinmeyen: 0 }, { toplam: 1000, bilinen: 1, bilinmeyen: 0 })).toBe(90);
    expect(gerceklesmeOrani({ toplam: 500, bilinen: 1, bilinmeyen: 0 }, { toplam: 0, bilinen: 0, bilinmeyen: 0 })).toBeNull();
    expect(gerceklesmeOrani({ toplam: 500, bilinen: 1, bilinmeyen: 1 }, { toplam: 1000, bilinen: 1, bilinmeyen: 0 })).toBeNull();
    expect(gerceklesmeOrani({ toplam: 500, bilinen: 1, bilinmeyen: 0 }, { toplam: 1000, bilinen: 1, bilinmeyen: 1 })).toBeNull();
  });
  it('fark: iki taraf da biliniyorsa gerçekleşen − bütçe; bilinmeyen varsa null', () => {
    expect(fark({ toplam: 900, bilinen: 1, bilinmeyen: 0 }, { toplam: 1000, bilinen: 1, bilinmeyen: 0 })).toBe(-100);
    expect(fark({ toplam: 500, bilinen: 1, bilinmeyen: 0 }, { toplam: 0, bilinen: 0, bilinmeyen: 0 })).toBe(500);
    expect(fark({ toplam: 900, bilinen: 1, bilinmeyen: 1 }, { toplam: 1000, bilinen: 1, bilinmeyen: 0 })).toBeNull();
  });
  it('butceGercekYili: ay satırları + toplamlar; bilinmeyen yayılır, butceVar', () => {
    const y = butceGercekYili(SIPARISLER_2026, FATURALAR_2026, BUTCELER, 2026);
    expect(y.aylar).toHaveLength(12);
    expect(y.aylar[0].fark).toBeNull();                    // bütçe kalemi okunamıyor
    expect(y.aylar[0].oran).toBeNull();
    expect(y.aylar[2].fark).toBeCloseTo(-1249.5, 6);
    expect(y.aylar[2].oran).toBeCloseTo(16.7, 1);
    expect(y.aylar[1].fark).toBeNull();                    // gerçekleşen bilinmiyor
    expect(y.aylar[3]).toMatchObject({ fark: null, oran: null }); // kalemsiz ay BÜTÇESİZ → fark da oran da yok (eskiden "+₺0")
    expect(y.toplamButce).toEqual({ toplam: 6500, bilinen: 2, bilinmeyen: 1 });
    expect(y.toplamGerceklesen).toEqual({ toplam: 3250.5, bilinen: 3, bilinmeyen: 2 });
    expect(y.fark).toBeNull();
    expect(y.oran).toBeNull();
    expect(y.butceVar).toBe(true);
    expect(y.butceliAyAdedi).toBe(2);
  });
  it('temiz veri: oran sayı; bütçe hiç yoksa butceVar false ve yıl farkı null', () => {
    const y = butceGercekYili([SIPARISLER_2026[0]], [FATURALAR_2026[0]], { '2026-01': [{ budgetTRY: 4000 }] }, 2026);
    expect(y.aylar[0]).toMatchObject({ fark: -1000, oran: 75 });
    expect(y.oran).toBe(75);
    const bos = butceGercekYili([], [], {}, 2026);
    expect(bos.butceVar).toBe(false);
    expect(bos).toMatchObject({ fark: null, oran: null, butceliAyAdedi: 0 });
    // ₺0 girilmiş kalem BÜTÇELİ aydır: "bütçe tanımlanmamış" uyarısı ile "1 ay bütçeli" notu aynı ekranda çelişmesin (2. hakem)
    expect(butceGercekYili([], [], { '2026-01': [{ budgetTRY: 0 }] }, 2026)).toMatchObject({ butceVar: true, butceliAyAdedi: 1 });
  });
  it("bütçesiz ayın cirosu yıl farkına GİRMEZ: Ocak bütçeli (4000), Mart bütçesiz (250,5 ciro) → fark −1000, Mart satırı '—'", () => {
    const y = butceGercekYili(SIPARISLER_2026, FATURALAR_2026, { '2026-01': [{ budgetTRY: 4000 }] }, 2026);
    expect(y.toplamGerceklesen.toplam).toBeCloseTo(3250.5, 6);   // KPI tüm yıl
    expect(y.fark).toBe(-1000);                                   // yalnız Ocak: 3000 − 4000 (eskiden 3250,5 − 4000)
    expect(y.oran).toBe(75);
    expect(y.aylar[2]).toMatchObject({ fark: null, oran: null });
    expect(y.butceliAyAdedi).toBe(1);
  });
});

describe('Phase 617 — KDV mutabakat', () => {
  const KDV_FATURALAR = [
    { yon: 'giden', tarih: '2026-09-05', tutar: 1200, matrah: 1000, kdv: 200, oran: 20, oranKarma: false },
    { yon: 'giden', tarih: '2026-09-10', tutar: 1100, matrah: 1000, kdv: 100, oran: 10, oranKarma: false },
    { yon: 'giden', tarih: '2026-09-11', tutar: 2300, matrah: 2000, kdv: 300, oran: 20, oranKarma: true },   // karma (%10 + %20)
    { yon: 'giden', tarih: '2026-09-12', tutar: 500, matrah: 500, kdv: 0, oran: null, oranKarma: false },     // oran çözülememiş
    { yon: 'gelen', tarih: '2026-09-06', tutar: 9000, matrah: 7500, kdv: 1500, oran: 20, oranKarma: false },  // alış
    { yon: 'giden', tarih: '2026-08-30', tutar: 8000, matrah: 6667, kdv: 1333, oran: 20, oranKarma: false },  // önceki ay
    { yon: 'giden', tarih: '2026-09-13', tutar: undefined, matrah: undefined, kdv: undefined, oran: 20, oranKarma: false }, // bilinmeyen
  ];
  const KDV_SIPARISLER = [
    { customerName: 'Çelik Yapı', totalPrice: 400, status: 'Delivered', createdAt: t(2026, 9, 2) },
    { customerName: 'Şahin Ltd.', totalPrice: null, status: 'Delivered', createdAt: t(2026, 9, 3) },              // bilinmeyen
    { customerName: 'Faturalı', totalPrice: 900, status: 'Delivered', faturali: true, createdAt: t(2026, 9, 4) },
    { customerName: 'hasInvoice', totalPrice: 800, status: 'Delivered', hasInvoice: true, createdAt: t(2026, 9, 4) },
    { customerName: 'Türetme', totalPrice: 700, status: 'Delivered', source: 'mikro-fatura', createdAt: t(2026, 9, 4) },
    { customerName: 'İptal', totalPrice: 600, status: 'Cancelled', createdAt: t(2026, 9, 4) },
    { customerName: 'Ağustos', totalPrice: 300, status: 'Delivered', createdAt: t(2026, 8, 31) },
    { customerName: 'Shopify Aynası', totalPrice: 50, status: 'Delivered', syncedAt: t(2026, 9, 5) },            // createdAt yok
  ];
  const m = kdvMutabakat(KDV_FATURALAR, KDV_SIPARISLER, '2026-09');
  it('dönem süzgeci: yalnız giden + seçili ay; faturasız = iptal/faturalı/hasInvoice/Mikro-kaynaklı dışı', () => {
    expect(m.faturaAdedi).toBe(5);
    expect(m.faturasizAdedi).toBe(3);
    expect(donemFaturasizSiparisler(KDV_SIPARISLER, '2026-09').map(o => o.customerName)).toEqual(['Çelik Yapı', 'Şahin Ltd.', 'Shopify Aynası']);
  });
  it('faturasız tutar: null 0 SAYILMAZ → {450, bilinmeyen 1}', () => {
    expect(m.faturasizTutar).toEqual({ toplam: 450, bilinen: 2, bilinmeyen: 1 });
  });
  it('ciro/matrah/kdv: bilinen toplam + bilinmeyen sayacı (faturasız matraha girer, KDV\'ye girmez)', () => {
    expect(m.ciro).toEqual({ toplam: 5550, bilinen: 6, bilinmeyen: 2 });
    expect(m.matrah).toEqual({ toplam: 4950, bilinen: 6, bilinmeyen: 2 });
    expect(m.kdv).toEqual({ toplam: 600, bilinen: 4, bilinmeyen: 1 });
    expect(paraYaz(ekranTutari(m.kdv), { ondalik: 0 })).toBe('₺600');   // kısmi toplam; sayfa "1 kayıt tutarsız" notu basar
  });
  it('bantlar: orana göre azalan; karma ve bilinmiyor ayrı kova, tek oran UYDURULMAZ (oran null)', () => {
    expect(m.bantlar.map(b => b.anahtar)).toEqual(['20', '10', 'karma', 'bilinmiyor']);
    expect(m.bantlar[0]).toEqual({ anahtar: '20', oran: 20, oranKarma: false, matrah: { toplam: 1000, bilinen: 1, bilinmeyen: 1 }, kdv: { toplam: 200, bilinen: 1, bilinmeyen: 1 }, adet: 2, tutarsiz: 1 });
    expect(m.bantlar[2]).toMatchObject({ tutarsiz: 0 });
    expect(m.bantlar[2]).toMatchObject({ anahtar: 'karma', oran: null, oranKarma: true, adet: 1, matrah: { toplam: 2000, bilinmeyen: 0 } });
    expect(m.bantlar[3]).toMatchObject({ anahtar: 'bilinmiyor', oran: null, oranKarma: false, adet: 1 });
  });
  it('boş dönem → sıfır toplamlar, bant yok; boş ay anahtarı → hiçbir şey', () => {
    const bos = kdvMutabakat(KDV_FATURALAR, KDV_SIPARISLER, '2024-01');
    expect(bos).toMatchObject({ faturaAdedi: 0, faturasizAdedi: 0, ciro: { toplam: 0, bilinmeyen: 0 }, kdv: { toplam: 0, bilinmeyen: 0 }, bantlar: [] });
    expect(kdvMutabakat(KDV_FATURALAR, KDV_SIPARISLER, '').faturaAdedi).toBe(0);
    expect(kdvBantlari([])).toEqual([]);
  });
});

describe('Phase 625 — gelir bütçesi vs gerçekleşen', () => {
  const GELIR_BUTCELERI = [
    { month: 0, budgetRevenue: 1000 },
    { month: 0, budgetRevenue: 2000 },   // aynı ay iki kayıt → son kazanır (sayfa parity)
    { month: 2, budgetRevenue: '' },     // kalem var, değer okunamıyor
    { month: 5, budgetRevenue: 4000 },
  ];
  it('aylikGelirButcesi: son kayıt kazanır; okunamayan → NaN (0 DEĞİL); kalem yok → null (bütçesiz, 0 DEĞİL)', () => {
    expect(aylikGelirButcesi(GELIR_BUTCELERI, 0)).toBe(2000);
    expect(Number.isNaN(aylikGelirButcesi(GELIR_BUTCELERI, 2))).toBe(true);
    expect(aylikGelirButcesi(GELIR_BUTCELERI, 4)).toBeNull();
  });
  it('gelirButceYili: sapma/yüzde; bütçe 0 ya da bilinmeyen → yüzde null; toplamlar sayaçlı', () => {
    const y = gelirButceYili(SIPARISLER_2026, FATURALAR_2026, GELIR_BUTCELERI, 2026);
    expect(y.aylar[0]).toMatchObject({ butce: 2000, gerceklesen: { toplam: 3000, bilinmeyen: 0 }, sapma: 1000, sapmaYuzde: 50 });
    expect(y.aylar[1]).toMatchObject({ sapma: null, sapmaYuzde: null });         // gerçekleşen bilinmiyor
    expect(y.aylar[2]).toMatchObject({ sapma: null, sapmaYuzde: null });         // bütçe okunamıyor
    expect(Number.isNaN(y.aylar[2].butce)).toBe(true);
    expect(y.aylar[4]).toMatchObject({ butce: null, sapma: null, sapmaYuzde: null });  // kalem yok → bütçesiz ay, sapma yok
    expect(y.aylar[5]).toMatchObject({ sapma: -4000, sapmaYuzde: -100 });
    expect(y.toplamButce).toEqual({ toplam: 6000, bilinen: 2, bilinmeyen: 1 });   // 2 okunan + 1 okunamayan ay; kalemsiz 9 ay sayılmaz
    expect(y.toplamGerceklesen).toEqual({ toplam: 3250.5, bilinen: 3, bilinmeyen: 2 });
    expect(y.sapma).toBeNull();                                                   // Mart bütçesi okunamıyor → yıl sapması yok
    expect(y.sapmaYuzde).toBeNull();
    expect(y.butceliAyAdedi).toBe(3);
  });
  it('temiz veri: toplam sapma ve yüzde sayı; bütçesiz ayın cirosu sapmaya GİRMEZ', () => {
    const y = gelirButceYili([SIPARISLER_2026[0]], [FATURALAR_2026[0]], [{ month: 0, budgetRevenue: 4000 }], 2026);
    expect(y.sapma).toBe(-1000);
    expect(y.sapmaYuzde).toBe(-25);
    const y2 = gelirButceYili(SIPARISLER_2026, FATURALAR_2026, [{ month: 0, budgetRevenue: 4000 }], 2026);
    expect(y2.sapma).toBe(-1000);                       // Mart'ın 250,5'i bütçesiz → dışarıda (eskiden 3250,5 − 4000 = −749,5)
    expect(y2.toplamGerceklesen.toplam).toBeCloseTo(3250.5, 6);
    expect(gelirButceYili([], [], [], 2026)).toMatchObject({ sapma: null, sapmaYuzde: null, butceliAyAdedi: 0 });
  });
});

describe('Phase 634 — varyans analizi', () => {
  it('varyansAylari: bu ay / geçen ay / yıl başından bugüne', () => {
    expect(varyansAylari('this_month', SIMDI)).toEqual([new Date(2026, 8, 1)]);
    expect(varyansAylari('last_month', SIMDI)).toEqual([new Date(2026, 7, 1)]);
    const ytd = varyansAylari('ytd', SIMDI);
    expect(ytd).toHaveLength(9);
    expect(ytd[0]).toEqual(new Date(2026, 0, 1));
    expect(ytd[8]).toEqual(new Date(2026, 8, 1));
    expect(varyansAylari('ytd', new Date(2026, 0, 20))).toHaveLength(1);
  });
  const SIP = [{ customerName: 'Şirin İnşaat', totalPrice: 1000, status: 'Delivered', createdAt: t(2026, 9, 2), lineItems: [{ costPrice: 300, quantity: 2 }] }];
  const FAT = [{ yon: 'giden', tarih: '2026-09-08', tutar: 500, matrah: 416.67, kdv: 83.33 }];
  const SATIRSIZ = { customerName: 'Satırsız', totalPrice: 200, status: 'Delivered', createdAt: t(2026, 9, 3) };   // lineItems yok → SMM bilinmiyor
  const TUTARSIZ = { customerName: 'Tutarsız', totalPrice: undefined, status: 'Delivered', createdAt: t(2026, 9, 4) };
  const AGUSTOS = { customerName: 'Ağustos', totalPrice: 80, status: 'Delivered', createdAt: t(2026, 8, 20) };
  it('satırlar: gelir 1500 / SMM 600; bütçe tarafı VARSAYIMSAL katsayılarla (bayrak açık)', () => {
    const v = varyansAnalizi(SIP, FAT, 'this_month', SIMDI);
    expect(v.gelir).toEqual({ toplam: 1500, bilinen: 2, bilinmeyen: 0 });
    expect(v.smm).toEqual({ toplam: 600, bilinen: 1, bilinmeyen: 0 });
    expect(v.butceVarsayimsal).toBe(true);
    expect(v.satirlar.map(s => s.anahtar)).toEqual(['gelir', 'smm', 'brutKar', 'opex', 'favok']);
    const [gelir, smm, brut, opex, favok] = v.satirlar;
    expect(gelir.butce).toBeCloseTo(1500 * VARYANS_VARSAYIMLARI.butceGelirKatsayisi, 6);
    expect(gelir).toMatchObject({ gerceklesen: 1500, olumlu: false, gerceklesenVarsayimsal: false });
    expect(gelir.sapma).toBeCloseTo(-225, 6);
    expect(gelir.sapmaYuzde).toBeCloseTo(-13.04, 2);
    expect(smm.butce).toBeCloseTo(825, 6);
    expect(smm).toMatchObject({ gerceklesen: 600, olumlu: true });   // maliyet bütçenin altında = olumlu
    expect(brut.butce).toBeCloseTo(900, 6);
    expect(brut.gerceklesen).toBe(900);
    expect(brut.sapma).toBeCloseTo(0, 6);
    expect(brut.olumlu).toBe(true);
    expect(opex).toMatchObject({ gerceklesenVarsayimsal: true, olumlu: true });
    expect(opex.gerceklesen).toBeCloseTo(270, 6);
    expect(favok).toMatchObject({ gerceklesenVarsayimsal: true, olumlu: true });
    expect(favok.gerceklesen).toBeCloseTo(630, 6);
    expect(favok.sapmaYuzde).toBeCloseTo(5, 6);
  });
  it('SMM bilinmiyorsa (satırsız sipariş) %48 UYDURULMAZ: SMM KISMİ basılır ama sapması yok; brüt/FAVÖK "—"; gelir satırı sağlam', () => {
    const v = varyansAnalizi([...SIP, SATIRSIZ], FAT, 'this_month', SIMDI);
    expect(v.smm).toEqual({ toplam: 600, bilinen: 1, bilinmeyen: 1 });
    const [gelir, smm, brut, , favok] = v.satirlar;
    expect(gelir.gerceklesen).toBe(1700);
    expect(gelir.sapma).not.toBeNull();
    expect(smm.gerceklesen).toBe(600);                            // ekranTutari: kısmi toplam (sayfa notu: "1 siparişin satır maliyeti yok")
    expect(smm.butce).toBeCloseTo(1700 * VARYANS_VARSAYIMLARI.butceSmmOrani, 6);
    expect(smm).toMatchObject({ sapma: null, sapmaYuzde: null, olumlu: null });   // kısmi SMM'den sapma ÜRETİLMEZ
    expect(Number.isNaN(brut.gerceklesen)).toBe(true);
    expect(Number.isNaN(favok.gerceklesen)).toBe(true);
    expect(paraYaz(brut.gerceklesen)).toBe('—');
  });
  it('gelir bilinmiyorsa bütçe de türetilemez: gelir KISMİ basılır, her satır bütçe NaN + sapma null', () => {
    const v = varyansAnalizi([...SIP, TUTARSIZ], FAT, 'this_month', SIMDI);
    expect(v.gelir).toEqual({ toplam: 1500, bilinen: 2, bilinmeyen: 1 });
    expect(v.satirlar[0].gerceklesen).toBe(1500);                 // Kâr/Zarar ile aynı kısmi sayı
    expect(Number.isNaN(v.satirlar[2].gerceklesen)).toBe(true);   // brüt kâr türetilemez
    expect(v.satirlar.every(s => s.sapma === null && s.olumlu === null && Number.isNaN(s.butce))).toBe(true);
    const hicBilinmeyen = varyansAnalizi([TUTARSIZ], [], 'this_month', SIMDI);
    expect(paraYaz(hicBilinmeyen.satirlar[0].gerceklesen)).toBe('—');   // hiç bilinen yok → '—'
  });
  it('geçen ay yalnız Ağustos; boş dönem → sıfırlar, yüzde null', () => {
    const v = varyansAnalizi([...SIP, AGUSTOS], FAT, 'last_month', SIMDI);
    expect(v.gelir).toEqual({ toplam: 80, bilinen: 1, bilinmeyen: 0 });
    const bos = varyansAnalizi([], [], 'this_month', SIMDI);
    expect(bos.gelir).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(bos.satirlar[0]).toMatchObject({ butce: 0, gerceklesen: 0, sapma: null, sapmaYuzde: null, olumlu: null });   // veri yokken "olumlu +₺0" hükmü YOK
    expect(bos.satirlar.every(s => s.sapma === null && s.olumlu === null)).toBe(true);
  });
});

describe('KPI kartı gösterimi — kur yoksa "—" (sayfadaki fmtKpi yerine kisaTutar)', () => {
  it('USD seçili ama kur yok → "—"; TRY → kısa biçim; bilinmeyen → "—"', () => {
    expect(kisaTutar(3250.5, { birim: 'USD', rates: null, fmt: 'K', ondalik: 1 })).toBe('—');
    expect(kisaTutar(3250.5, { birim: 'TRY', fmt: 'K', ondalik: 1 })).toBe('₺3,3K');
    expect(kisaTutar(ekranTutari({ toplam: 0, bilinen: 0, bilinmeyen: 2 }), { fmt: 'K' })).toBe('—');
  });
});
