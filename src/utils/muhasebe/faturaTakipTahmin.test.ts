/**
 * faturaTakipTahmin.test.ts — MuhasebePage Phase 564 (e-Fatura Takip) + 630 (Fatura Yaşlandırma) +
 * 565 (Satış Tahmini) + 566 (Kar Merkezi) hesap sözleşmesi. ÖNCE YAZILDI (Faz 3 1/n, 2026-09-13).
 *
 * Sahte kesinlik siteleri (sayfa, yaklaşık satır):
 *   2776  `(li.price||0)*(li.quantity||1)`      → fiyatı/miktarı bilinmeyen kalem ₺0 / ×1 basılıyordu
 *   2819  `s+(o.totalPrice||0)` (totalUnpaid)    → tutarı bilinmeyen açık sipariş ₺0 "bekleyen" sayılıyordu
 *   2836  kova reduce `(o.totalPrice||0)`        → aynı, kova başına
 *   2857  ay cirosu `s+(o.totalPrice||0)`        → tahmin girdisi eksik ciroyla besleniyordu
 *   2946  `revenue += o.totalPrice || 0`          → kar merkezi geliri eksik
 *   2947  `(li.costPrice??0)*li.quantity`         → maliyeti bilinmeyen kalem ₺0 maliyet = %100 marj
 * Kural (CLAUDE.md): bilinmeyen tutar toplama GİRMEZ, SAYILIR; ekranda '—' + "N kayıt tutarsız".
 */
import { describe, it, expect } from 'vitest';
import { paraYaz } from '../currency';
import { satirTutari, ekranTutari } from '../para';
import { kovaTutari } from './arYaslandirma';
import {
  faturaYaslandirma, satisTahmini, karMerkezleri, karMerkeziToplami, tahminTutari,
  type YaslandirmaGirdisi, type TahminSiparisi, type KarSiparisi,
} from './faturaTakipTahmin';

// 13 Eylül 2026 08:00, yerel. Gün aritmetiği `new Date(y, m, d - n)` ile — DST/UTC kayması yok.
const SIMDI = new Date(2026, 8, 13, 8, 0);
const gunOnce = (n: number, saat = 12): Date => new Date(2026, 8, 13 - n, saat, 0);
const ayOnce = (n: number, gun = 10): Date => new Date(2026, 8 - n, gun, 12, 0);

// ── Phase 630: Fatura Yaşlandırma ───────────────────────────────────────────────────────────────
const acik = (p: Partial<YaslandirmaGirdisi> & { gun?: number }): YaslandirmaGirdisi => {
  const { gun, ...rest } = p;
  return { customerName: 'Şahin İnşaat', totalPrice: 1000, paid: false, status: 'Confirmed', ...(gun === undefined ? {} : { createdAt: gunOnce(gun) }), ...rest };
};

describe('faturaYaslandirma — Phase 630 dönem penceresi + yaş kovaları', () => {
  it('ödenmiş / iptal / Mikro kaynaklı (paid YOK = bilinmiyor) dışlanır; faturalı sayfadaki gibi DAHİL', () => {
    const r = faturaYaslandirma([
      acik({ gun: 5 }),
      acik({ gun: 5, paid: true }),
      acik({ gun: 5, status: 'Cancelled' }),
      acik({ gun: 5, source: 'mikro-fatura', paid: undefined }),
      acik({ gun: 5, source: 'mikro-siparis', paid: undefined }),
      acik({ gun: 5, faturali: true, customerName: 'Çağlayan Yapı' }),
    ], { donemGun: 30, simdi: SIMDI });
    expect(r.adet).toBe(2);
    expect(r.toplam).toBe(2000);
    expect(r.bilinen).toBe(2);
    expect(r.bilinmeyen).toBe(0);
  });

  it('dönem penceresi: donemGun içindeki siparişler; 30 gün DAHİL, 31 gün DIŞARIDA', () => {
    const r = faturaYaslandirma([acik({ gun: 30 }), acik({ gun: 31 })], { donemGun: 30, simdi: SIMDI });
    expect(r.adet).toBe(1);
    expect(r.kovaAdet).toEqual({ b0_30: 1, b31_60: 0, b61_90: 0, b90p: 0 });
  });

  it('kovalar: ≤30 / 31-60 / 61-90 / 91+ — geniş pencerede 90+ kovası dolar', () => {
    const r = faturaYaslandirma(
      [acik({ gun: 0, totalPrice: 100 }), acik({ gun: 31, totalPrice: 200 }), acik({ gun: 61, totalPrice: 300 }), acik({ gun: 91, totalPrice: 400 })],
      { donemGun: 365, simdi: SIMDI },
    );
    expect(r.kovaAdet).toEqual({ b0_30: 1, b31_60: 1, b61_90: 1, b90p: 1 });
    expect(r.kovalar).toEqual({ b0_30: 100, b31_60: 200, b61_90: 300, b90p: 400 });
    expect(r.toplam).toBe(1000);
    expect(r.adet).toBe(4);
  });

  it('gün farkı YEREL güne göre: 31 gün önce 23:00 açılan sipariş, bugün 08:00 → 31 gün (ham ms bölmesi 30 derdi)', () => {
    const r = faturaYaslandirma([acik({ createdAt: gunOnce(31, 23) })], { donemGun: 365, simdi: SIMDI });
    expect(r.kovaAdet.b31_60).toBe(1);
    expect(r.kovaAdet.b0_30).toBe(0);
  });

  it("tutarı bilinmeyen (undefined/null/''/NaN/'abc') açık sipariş: toplama GİRMEZ, adet + bilinmeyen + kovaBilinmeyen SAYILIR", () => {
    const r = faturaYaslandirma([
      acik({ gun: 3, totalPrice: 500 }),
      acik({ gun: 3, totalPrice: undefined }),
      acik({ gun: 3, totalPrice: null }),
      acik({ gun: 40, totalPrice: '' }),
      acik({ gun: 40, totalPrice: NaN }),
      acik({ gun: 40, totalPrice: 'abc' }),
    ], { donemGun: 90, simdi: SIMDI });
    expect(r.toplam).toBe(500);
    expect(r.adet).toBe(6);
    expect(r.bilinen).toBe(1);
    expect(r.bilinmeyen).toBe(5);
    expect(r.kovaBilinen).toEqual({ b0_30: 1, b31_60: 0, b61_90: 0, b90p: 0 });
    expect(r.kovaBilinmeyen).toEqual({ b0_30: 2, b31_60: 3, b61_90: 0, b90p: 0 });
    expect(r.kovaAdet).toEqual({ b0_30: 3, b31_60: 3, b61_90: 0, b90p: 0 });
    expect(r.kovalar.b0_30).toBe(500);
    expect(r.kovalar.b31_60).toBe(0);
  });

  it("ekran: para.ts ekranTutari TEK sözleşme — kısmi bilinen → kısmi toplam (+ sayfa notu), hiç bilinen yok → NaN ('—')", () => {
    // 10 açık sipariş, 1'inin tutarı yok: Toplam Bekleyen ₺9.000 + "1 kayıt tutarsız" — '—' DEĞİL
    // (Bilanço/KDV/AR yaşlandırma aynı veriye kısmi toplam basar; eski gosterTutar '—' basıp sapma yaratıyordu).
    const kismi = faturaYaslandirma([...Array.from({ length: 9 }, () => acik({ gun: 2 })), acik({ gun: 2, totalPrice: undefined })], { donemGun: 30, simdi: SIMDI });
    expect(ekranTutari(kismi)).toBe(9000);
    expect(kismi.bilinmeyen).toBe(1);
    expect(kovaTutari(kismi, 'b0_30')).toBe(9000);
    // Kovada hiç bilinen yok → o kova '—'; genel toplam yine kısmi
    const kovasiz = faturaYaslandirma([acik({ gun: 2, totalPrice: 700 }), acik({ gun: 45, totalPrice: null })], { donemGun: 90, simdi: SIMDI });
    expect(kovaTutari(kovasiz, 'b31_60')).toBeNaN();
    expect(kovaTutari(kovasiz, 'b0_30')).toBe(700);
    expect(ekranTutari(kovasiz)).toBe(700);
    // Hiç bilinen yok → NaN → paraYaz '—'
    const hicYok = faturaYaslandirma([acik({ gun: 2, totalPrice: undefined }), acik({ gun: 2, totalPrice: 'abc' })], { donemGun: 30, simdi: SIMDI });
    expect(ekranTutari(hicYok)).toBeNaN();
    expect(paraYaz(ekranTutari(hicYok))).toBe('—');
    // Boş pencere gerçek 0
    expect(ekranTutari(faturaYaslandirma([], { donemGun: 30, simdi: SIMDI }))).toBe(0);
  });

  it("sayısal string kabul ('1250.5' DB'den gelebilir); 0 gerçek sıfırdır", () => {
    const r = faturaYaslandirma([acik({ gun: 1, totalPrice: '1250.5' }), acik({ gun: 1, totalPrice: 0 })], { donemGun: 7, simdi: SIMDI });
    expect(r.toplam).toBe(1250.5);
    expect(r.bilinmeyen).toBe(0);
    expect(r.adet).toBe(2);
  });

  it('tarihi çözülemeyen aday: tarihsiz sayılır, BUGÜNE düşürülmez, adete girmez', () => {
    const r = faturaYaslandirma([acik({}), acik({ createdAt: 'bugün' }), acik({ gun: 2 })], { donemGun: 7, simdi: SIMDI });
    expect(r.tarihsiz).toBe(2);
    expect(r.adet).toBe(1);
    expect(r.toplam).toBe(1000);
  });

  it('createdAt yoksa syncedAt (Shopify aynası) — Phase 131 müşteri yaşlandırmasıyla aynı kural', () => {
    const r = faturaYaslandirma([acik({ syncedAt: gunOnce(4) }), acik({ createdAt: { _seconds: Math.floor(gunOnce(2).getTime() / 1000), _nanoseconds: 0 } })], { donemGun: 7, simdi: SIMDI });
    expect(r.adet).toBe(2);
    expect(r.tarihsiz).toBe(0);
  });

  it('boş liste → sıfırlar', () => {
    const r = faturaYaslandirma([], { donemGun: 30, simdi: SIMDI });
    expect(r).toEqual({ adet: 0, toplam: 0, bilinen: 0, bilinmeyen: 0, tarihsiz: 0, kovalar: { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 }, kovaAdet: { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 }, kovaBilinen: { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 }, kovaBilinmeyen: { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 } });
  });
});

// ── Phase 565: Satış Tahmini ────────────────────────────────────────────────────────────────────
const sip = (p: Partial<TahminSiparisi>): TahminSiparisi => ({ status: 'Confirmed', totalPrice: 100, ...p });

describe('satisTahmini — Phase 565 ağırlıklı hareketli ortalama + eğim', () => {
  it('6 aylık geçmiş: [100..600] → wma 5600/13.5, eğim 100, tahmin = max(0, wma + eğim·k), ±%15 bant', () => {
    const liste = [5, 4, 3, 2, 1, 0].map((n, i) => sip({ totalPrice: (i + 1) * 100, createdAt: ayOnce(n) }));
    const r = satisTahmini(liste, SIMDI);
    expect(r.gecmis.map(a => a.toplam)).toEqual([100, 200, 300, 400, 500, 600]);
    expect(r.gecmis.map(a => a.anahtar)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(r.wma).toBeCloseTo(5600 / 13.5, 6);
    expect(r.egim).toBeCloseTo(100, 6);
    expect(r.tahmin).toHaveLength(3);
    expect(r.tahmin.map(t => t.anahtar)).toEqual(['2026-10', '2026-11', '2026-12']);
    const wma = 5600 / 13.5;
    expect(r.tahmin.map(t => t.deger)).toEqual([wma + 100, wma + 200, wma + 300].map(v => expect.closeTo(v, 6)));
    expect(r.tahmin.map(t => t.alt)).toEqual([wma + 100, wma + 200, wma + 300].map(v => expect.closeTo(v * 0.85, 6)));
    expect(r.tahmin.map(t => t.ust)).toEqual([wma + 100, wma + 200, wma + 300].map(v => expect.closeTo(v * 1.15, 6)));
    expect(r.tahmin.map(t => t.ay.getMonth())).toEqual([9, 10, 11]);
    expect(r.bilinen).toBe(6);
    expect(r.bilinmeyen).toBe(0);
    expect(r.tarihsiz).toBe(0);
  });

  it('düşen trend: tahmin negatife düşmez, 0\'a kırpılır', () => {
    const liste = [5, 4, 3, 2, 1, 0].map((n, i) => sip({ totalPrice: (6 - i) * 100, createdAt: ayOnce(n) }));
    const r = satisTahmini(liste, SIMDI);
    expect(r.egim).toBeCloseTo(-100, 6);
    expect(r.tahmin[2]?.deger).toBe(0);
    expect(r.tahmin[2]?.alt).toBe(0);
    expect(r.tahmin[2]?.ust).toBe(0);
  });

  it('iptal, 6 ay penceresi dışı ve gelecek aylı siparişler ciroya girmez; Mikro kaynaklı ciro DAHİL (sayfadaki gibi)', () => {
    const r = satisTahmini([
      sip({ totalPrice: 100, createdAt: ayOnce(0) }),
      sip({ totalPrice: 999, createdAt: ayOnce(0), status: 'Cancelled' }),
      sip({ totalPrice: 999, createdAt: ayOnce(6) }),
      sip({ totalPrice: 999, createdAt: new Date(2026, 9, 1) }),
      sip({ totalPrice: 50, createdAt: ayOnce(0), source: 'mikro-fatura' }),
    ], SIMDI);
    expect(r.gecmis[5]?.toplam).toBe(150);
    expect(r.gecmis[5]?.adet).toBe(2);
    expect(r.gecmis.slice(0, 5).map(a => a.toplam)).toEqual([0, 0, 0, 0, 0]);
  });

  it('tutarı bilinmeyen sipariş: ay toplamına GİRMEZ, ayın ve genelin bilinmeyeni SAYILIR', () => {
    const r = satisTahmini([
      sip({ totalPrice: 300, createdAt: ayOnce(1) }),
      sip({ totalPrice: undefined, createdAt: ayOnce(1) }),
      sip({ totalPrice: '', createdAt: ayOnce(0) }),
      sip({ totalPrice: NaN, createdAt: ayOnce(0) }),
      sip({ totalPrice: '250', createdAt: ayOnce(0) }),
    ], SIMDI);
    expect(r.gecmis[4]?.toplam).toBe(300);
    expect(r.gecmis[4]?.bilinen).toBe(1);
    expect(r.gecmis[4]?.bilinmeyen).toBe(1);
    expect(r.gecmis[5]?.toplam).toBe(250);
    expect(r.gecmis[5]?.bilinen).toBe(1);
    expect(r.gecmis[5]?.bilinmeyen).toBe(2);
    expect(r.bilinen).toBe(2);
    expect(r.bilinmeyen).toBe(3);
  });

  it("tahminTutari — para.ts ekranTutari sözleşmesi: kısmi bilinen → tahmin basılır (+ sayfa notu), hiç bilinen yok → NaN ('—'), boş pencere 0", () => {
    const kismi = satisTahmini([sip({ totalPrice: 300, createdAt: ayOnce(1) }), sip({ totalPrice: undefined, createdAt: ayOnce(0) })], SIMDI);
    expect(kismi.bilinen).toBe(1);
    expect(kismi.bilinmeyen).toBe(1);
    expect(tahminTutari(kismi, kismi.tahmin[0]?.deger ?? NaN)).toBe(kismi.tahmin[0]?.deger);
    expect(Number.isFinite(tahminTutari(kismi, kismi.tahmin[0]?.alt ?? NaN))).toBe(true);
    const hicYok = satisTahmini([sip({ totalPrice: undefined, createdAt: ayOnce(0) }), sip({ totalPrice: '', createdAt: ayOnce(2) })], SIMDI);
    expect(hicYok.bilinen).toBe(0);
    expect(tahminTutari(hicYok, hicYok.tahmin[0]?.deger ?? NaN)).toBeNaN();
    expect(paraYaz(tahminTutari(hicYok, 0))).toBe('—');
    const bos = satisTahmini([], SIMDI);
    expect(tahminTutari(bos, bos.tahmin[0]?.deger ?? NaN)).toBe(0);
  });

  it("tarihi çözülemeyen sipariş: tarihsiz sayılır, BU AYA yazılmaz; tarih-only string ('2026-09-01') yerel ay", () => {
    const r = satisTahmini([sip({ totalPrice: 100 }), sip({ totalPrice: 100, createdAt: 'dün' }), sip({ totalPrice: 100, createdAt: '2026-09-01' })], SIMDI);
    expect(r.tarihsiz).toBe(2);
    expect(r.gecmis[5]?.toplam).toBe(100);
  });

  it('boş liste → 6 sıfır ay, tahmin 0, bilinmeyen 0 (çökmez, NaN üretmez)', () => {
    const r = satisTahmini([], SIMDI);
    expect(r.gecmis).toHaveLength(6);
    expect(r.gecmis.every(a => a.toplam === 0 && a.adet === 0 && a.bilinen === 0 && a.bilinmeyen === 0)).toBe(true);
    expect(r.bilinen).toBe(0);
    expect(r.tahmin.map(t => t.deger)).toEqual([0, 0, 0]);
    expect(Number.isFinite(r.wma) && Number.isFinite(r.egim)).toBe(true);
  });
});

// ── Phase 566: Kar Merkezi ──────────────────────────────────────────────────────────────────────
const kar = (p: Partial<KarSiparisi>): KarSiparisi => ({ status: 'Confirmed', customerType: 'B2B', totalPrice: 1000, ...p });

describe('karMerkezleri — Phase 566 kanal bazlı gelir/maliyet/marj', () => {
  it('kanala göre gruplar; gelir, COGS (maliyet×miktar), brüt kar, marj; gelire göre azalan', () => {
    const r = karMerkezleri([
      kar({ customerType: 'B2B', totalPrice: 1000, lineItems: [{ name: 'Çimento 50kg', costPrice: 100, quantity: 5 }, { name: 'Demir Ø12', costPrice: 50, quantity: 4 }] }),
      kar({ customerType: 'B2B', totalPrice: 500, lineItems: [{ name: 'Kireç', costPrice: 25, quantity: 2 }] }),
      kar({ customerType: 'Perakende', totalPrice: 2000, lineItems: [{ name: 'Alçı', costPrice: 400, quantity: 1 }] }),
    ]);
    expect(r.map(m => m.ad)).toEqual(['Perakende', 'B2B']);
    const b2b = r[1];
    expect(b2b?.adet).toBe(2);
    expect(b2b?.gelir).toEqual({ toplam: 1500, bilinen: 2, bilinmeyen: 0 });
    expect(b2b?.maliyet).toEqual({ toplam: 750, bilinen: 3, bilinmeyen: 0 });
    expect(b2b?.brutKar).toBe(750);
    expect(b2b?.marj).toBeCloseTo(50, 6);
    expect(r[0]?.marj).toBeCloseTo(80, 6);
  });

  it("customerType yoksa 'Diğer' (çağıran dil etiketini verir); iptal dışlanır; kalemsiz sipariş maliyet 0", () => {
    const r = karMerkezleri([kar({ customerType: undefined }), kar({ customerType: '', totalPrice: 200 }), kar({ status: 'Cancelled', totalPrice: 9999 })], 'Diğer');
    expect(r).toHaveLength(1);
    expect(r[0]?.ad).toBe('Diğer');
    expect(r[0]?.adet).toBe(2);
    expect(r[0]?.gelir.toplam).toBe(1200);
    expect(r[0]?.maliyet).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });

  it("geliri bilinmeyen sipariş: adete girer, gelire GİRMEZ, bilinmeyen sayılır; ekranTutari kısmi toplam basar (+ sayfa notu); brüt kâr/marj TÜRETİLMEZ", () => {
    const r = karMerkezleri([kar({ totalPrice: 400 }), kar({ totalPrice: undefined }), kar({ totalPrice: null }), kar({ totalPrice: 'abc' })]);
    expect(r[0]?.adet).toBe(4);
    expect(r[0]?.gelir).toEqual({ toplam: 400, bilinen: 1, bilinmeyen: 3 });
    expect(ekranTutari(r[0]?.gelir ?? { toplam: NaN, bilinen: 0, bilinmeyen: 0 })).toBe(400);
    expect(r[0]?.brutKar).toBeNaN();     // 3 siparişin tutarı eksikken "₺400 brüt kâr" yanlış bir sayı olurdu
    expect(r[0]?.marj).toBeNull();
  });

  it('maliyeti bilinmeyen kalem (costPrice yok / miktar yok): COGS\'a ₺0 girmez (eskiden %100 marj), maliyetBilinmeyen sayılır', () => {
    const r = karMerkezleri([kar({ totalPrice: 1000, lineItems: [
      { name: 'Çimento', costPrice: 100, quantity: 2 },
      { name: 'Tuğla', quantity: 100 },
      { name: 'Kum', costPrice: 30, quantity: undefined },
      { name: 'Çakıl', costPrice: '', quantity: 3 },
    ] })]);
    expect(r[0]?.maliyet).toEqual({ toplam: 200, bilinen: 1, bilinmeyen: 3 });
    expect(ekranTutari(r[0]?.maliyet ?? { toplam: NaN, bilinen: 0, bilinmeyen: 0 })).toBe(200);   // COGS hücresi kısmi + "3 kalem maliyetsiz"
    expect(r[0]?.brutKar).toBeNaN();      // eksik maliyet = şişkin marj: %80 basılmaz (2026-09-14 hakem turu), '—'
    expect(r[0]?.marj).toBeNull();
  });

  it("kalemlerin HİÇBİRİNİN maliyeti bilinmiyorsa COGS '—' (ekranTutari NaN), brüt kâr NaN, marj null", () => {
    const r = karMerkezleri([kar({ totalPrice: 1000, lineItems: [{ name: 'Tuğla', quantity: 100 }, { name: 'Kum', costPrice: 30 }] })]);
    expect(r[0]?.maliyet).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
    expect(ekranTutari(r[0]?.maliyet ?? { toplam: NaN, bilinen: 0, bilinmeyen: 0 })).toBeNaN();
    expect(r[0]?.brutKar).toBeNaN();
    expect(r[0]?.marj).toBeNull();
  });

  it('bilinen geliri 0 ya da tamamı bilinmeyen kanal: marj null (eskiden %0,0 kırmızı); tamamı bilinmeyen gelir ekranda NaN', () => {
    const r = karMerkezleri([kar({ totalPrice: undefined, customerType: 'Bayi' }), kar({ totalPrice: 0, customerType: 'Perakende' })]);
    const bayi = r.find(m => m.ad === 'Bayi');
    expect(bayi?.marj).toBeNull();
    expect(bayi?.gelir).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(ekranTutari(bayi?.gelir ?? { toplam: NaN, bilinen: 0, bilinmeyen: 0 })).toBeNaN();
    expect(bayi?.brutKar).toBeNaN();
    expect(r.find(m => m.ad === 'Perakende')?.marj).toBeNull();
  });

  it('boş liste → []', () => {
    expect(karMerkezleri([])).toEqual([]);
  });
});

describe('karMerkeziToplami — Phase 610 toplam satırı, kanal satırlarıyla aynı kural', () => {
  const kanallar = karMerkezleri([
    kar({ customerType: 'B2B', totalPrice: 1000, lineItems: [{ name: 'Çimento', costPrice: 100, quantity: 5 }] }),
    kar({ customerType: 'Perakende', totalPrice: 500, lineItems: [{ name: 'Alçı', costPrice: 50, quantity: 2 }] }),
  ]);
  it('gelir/maliyet sayaçları birleşir, adet toplanır, brüt kâr ve marj toplamdan', () => {
    const t = karMerkeziToplami(kanallar, 'Toplam');
    expect(t).toMatchObject({ ad: 'Toplam', adet: 2, gelir: { toplam: 1500, bilinen: 2, bilinmeyen: 0 }, maliyet: { toplam: 600, bilinen: 2, bilinmeyen: 0 }, brutKar: 900 });
    expect(t.marj).toBeCloseTo(60, 6);
  });
  it("bir kanalda tutarı bilinmeyen sipariş varsa toplam gelir kısmi (+ not), toplam brüt kâr/marj '—' (eskiden `totalRev>0 ? … : '0'`)", () => {
    const t = karMerkeziToplami([...kanallar, ...karMerkezleri([kar({ customerType: 'Bayi', totalPrice: undefined })])]);
    expect(t.gelir).toEqual({ toplam: 1500, bilinen: 2, bilinmeyen: 1 });
    expect(ekranTutari(t.gelir)).toBe(1500);
    expect(t.brutKar).toBeNaN();
    expect(t.marj).toBeNull();
    expect(t.adet).toBe(3);
  });
  it('kanal yoksa sıfır satır: gelir 0 gerçek 0, marj null (sıfıra bölme yok)', () => {
    expect(karMerkeziToplami([])).toEqual({ ad: 'Toplam', adet: 0, gelir: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, maliyet: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, brutKar: 0, marj: null });
  });
});

// Ekran köprüsü: para.ts `ekranTutari` (TEK sözleşme) — buradaki `gosterTutar` kopyası 2026-09-14 hakem
// turunda silindi; sözleşme testleri para.test.ts'te, bu modülün çıktılarına uygulanışı yukarıdaki vakalarda.

describe('Phase 564 kalem satırı — satirTutari (para.ts) ile', () => {
  it("`(li.price||0)*(li.quantity||1)` yerine: biri bilinmiyorsa '—', ikisi de biliniyorsa çarpım", () => {
    expect(paraYaz(satirTutari(250, 4))).toBe('₺1.000,00');
    expect(paraYaz(satirTutari(undefined, 4))).toBe('—');
    expect(paraYaz(satirTutari(250, undefined))).toBe('—');
    expect(paraYaz(satirTutari(250, 0))).toBe('₺0,00');
  });
});
