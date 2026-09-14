/**
 * arYaslandirma.test.ts — MuhasebePage Phase 131 (Müşteri Alacak Yaşlandırması) + Phase 178
 * (Eskalasyon) hesap sözleşmesi. ÖNCE YAZILDI (Faz 3 1/n, 2026-09-13).
 *
 * Sahte kesinlik sitesi: sayfa ~1111 `const amt = o.totalPrice || 0` — tutarı bilinmeyen sipariş
 * ₺0 alacak olarak kovaya giriyordu; müşteri "borcu yok" görünüyordu. Kural (CLAUDE.md):
 * bilinmeyen tutar toplama GİRMEZ, SAYILIR; ekranda '—' + "N kayıt tutarsız".
 */
import { describe, it, expect } from 'vitest';
import { tlYaz } from '../currency';
import {
  kovaTutari,
  yaslandirmaAdayi, yasKovasi, eskalasyonSeviyesi, arYaslandirma, toplamAlacak, gecikmisSiparisler,
  type YaslandirmaSiparisi,
} from './arYaslandirma';

// 13 Eylül 2026, yerel. Gün aritmetiği `new Date(y, m, d - n)` ile — DST/UTC kayması yok.
const SIMDI = new Date(2026, 8, 13);
const gunOnce = (n: number): Date => new Date(2026, 8, 13 - n);
const sip = (p: Partial<YaslandirmaSiparisi> & { gun?: number }): YaslandirmaSiparisi => {
  const { gun, ...rest } = p;
  return { customerName: 'Şahin İnşaat', totalPrice: 1000, paid: false, status: 'Confirmed', ...(gun === undefined ? {} : { createdAt: gunOnce(gun) }), ...rest };
};

describe('yaslandirmaAdayi — hangi sipariş alacak sayılır', () => {
  it('ödenmemiş + iptal değil + Cetpa-native + faturasız → aday', () => {
    expect(yaslandirmaAdayi(sip({}))).toBe(true);
  });
  it('ödenmiş ya da iptal → değil', () => {
    expect(yaslandirmaAdayi(sip({ paid: true }))).toBe(false);
    expect(yaslandirmaAdayi(sip({ status: 'Cancelled' }))).toBe(false);
  });
  it("Mikro kaynaklı (mikro-fatura / mikro-siparis) → değil: `paid` yokluğu BİLİNMİYOR'dur, ödenmedi değil", () => {
    expect(yaslandirmaAdayi(sip({ source: 'mikro-fatura', paid: undefined }))).toBe(false);
    expect(yaslandirmaAdayi(sip({ source: 'mikro-siparis', paid: undefined }))).toBe(false);
  });
  it('faturalı sipariş varsayılan olarak DIŞARIDA (cariBalances zaten sayıyor — çift sayım); faturaliHaric:false ile içeride (Phase 178 davranışı)', () => {
    expect(yaslandirmaAdayi(sip({ faturali: true }))).toBe(false);
    expect(yaslandirmaAdayi(sip({ faturali: true }), { faturaliHaric: false })).toBe(true);
  });
});

describe('yasKovasi — 0-30 / 31-60 / 61-90 / 90+ sınırları sayfadaki gibi (<=30, <=60, <=90)', () => {
  it('sınır günleri', () => {
    expect(yasKovasi(0)).toBe('b0_30');
    expect(yasKovasi(30)).toBe('b0_30');
    expect(yasKovasi(31)).toBe('b31_60');
    expect(yasKovasi(60)).toBe('b31_60');
    expect(yasKovasi(61)).toBe('b61_90');
    expect(yasKovasi(90)).toBe('b61_90');
    expect(yasKovasi(91)).toBe('b90p');
  });
  it('gelecek tarihli (negatif gün) en taze kovaya düşer, patlamaz', () => {
    expect(yasKovasi(-3)).toBe('b0_30');
  });
});

describe('eskalasyonSeviyesi — L1 (31-60) / L2 (61-90) / L3 (90+)', () => {
  it('sınırlar', () => {
    expect(eskalasyonSeviyesi(31)).toBe('L1');
    expect(eskalasyonSeviyesi(60)).toBe('L1');
    expect(eskalasyonSeviyesi(61)).toBe('L2');
    expect(eskalasyonSeviyesi(90)).toBe('L2');
    expect(eskalasyonSeviyesi(91)).toBe('L3');
  });
});

describe('arYaslandirma — müşteri bazında kovalar', () => {
  it('boş liste: müşteri yok, kovalar 0, toplam 0, sayaçlar 0', () => {
    expect(arYaslandirma([], SIMDI)).toEqual({
      musteriler: [], kovalar: { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 }, kovaBilinen: { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 },
      kovaBilinmeyen: { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 }, toplam: 0, bilinen: 0, bilinmeyen: 0, tarihsiz: 0,
    });
  });

  it('Türkçe müşteri adıyla gruplar, kovalara dağıtır, en eski günü tutar, toplam desc sıralar', () => {
    const o = arYaslandirma([
      sip({ customerName: 'Şahin İnşaat', gun: 10, totalPrice: 1000 }),
      sip({ customerName: 'Şahin İnşaat', gun: 45, totalPrice: 2500 }),
      sip({ customerName: 'Işık Yapı Malzemeleri', gun: 100, totalPrice: 4000 }),
    ], SIMDI);
    expect(o.musteriler.map(m => m.ad)).toEqual(['Işık Yapı Malzemeleri', 'Şahin İnşaat']);
    const sahin = o.musteriler[1];
    expect(sahin.kovalar).toEqual({ b0_30: 1000, b31_60: 2500, b61_90: 0, b90p: 0 });
    expect(sahin.toplam).toBe(3500);
    expect(sahin.enEski).toBe(45);
    expect(sahin.bilinmeyen).toBe(0);
    expect(o.musteriler[0].kovalar.b90p).toBe(4000);
    expect(o.kovalar).toEqual({ b0_30: 1000, b31_60: 2500, b61_90: 0, b90p: 4000 });
    expect(o.toplam).toBe(7500);
    expect(o.bilinmeyen).toBe(0);
    expect(o.tarihsiz).toBe(0);
  });

  it.each([undefined, null, '', NaN, 'abc', Infinity])('BİLİNMEYEN tutar (%s) 0 SAYILMAZ: toplama girmez, `bilinmeyen` ve kovanın sayacı artar, yaş yine bilinir', (v) => {
    const o = arYaslandirma([
      sip({ customerName: 'Çelik Hırdavat', gun: 10, totalPrice: 1000 }),
      sip({ customerName: 'Çelik Hırdavat', gun: 50, totalPrice: v }),
    ], SIMDI);
    expect(o.musteriler).toHaveLength(1);
    const c = o.musteriler[0];
    expect(c.toplam).toBe(1000);                 // eski `|| 0` da 1000 verirdi — fark aşağıdaki sayaçta
    expect(c.bilinmeyen).toBe(1);
    expect(c.kovalar.b31_60).toBe(0);
    expect(c.kovaBilinmeyen).toEqual({ b0_30: 0, b31_60: 1, b61_90: 0, b90p: 0 });
    expect(c.enEski).toBe(50);                   // tarih biliniyor, yaş sayılır
    expect(o.bilinmeyen).toBe(1);
    expect(o.kovaBilinmeyen.b31_60).toBe(1);
    expect(o.toplam).toBe(1000);
  });

  it("sayısal string ('1250.5', DB'den gelebilir) bilinen tutardır", () => {
    const o = arYaslandirma([sip({ gun: 5, totalPrice: '1250.5' })], SIMDI);
    expect(o.toplam).toBe(1250.5);
    expect(o.bilinmeyen).toBe(0);
  });

  it('tarihsiz ya da çözülemeyen tarihli sipariş BUGÜNE düşmez: yaşlandırmaya girmez, `tarihsiz` sayılır, tutarı toplama girmez', () => {
    const o = arYaslandirma([
      sip({ customerName: 'Öztürk Nalburiye', totalPrice: 900 }),                    // createdAt yok
      sip({ customerName: 'Öztürk Nalburiye', totalPrice: 800, createdAt: 'dün' }),  // çözülemez
      sip({ customerName: 'Öztürk Nalburiye', totalPrice: 700, gun: 3 }),
    ], SIMDI);
    expect(o.tarihsiz).toBe(2);
    expect(o.musteriler).toHaveLength(1);
    expect(o.musteriler[0].toplam).toBe(700);
    expect(o.toplam).toBe(700);
  });

  it('ödenmiş / iptal / Mikro kaynaklı / faturalı DIŞARIDA — sayaçlara da girmez', () => {
    const o = arYaslandirma([
      sip({ paid: true, gun: 40, totalPrice: undefined }),
      sip({ status: 'Cancelled', gun: 40 }),
      sip({ source: 'mikro-fatura', paid: undefined, gun: 40 }),
      sip({ faturali: true, gun: 40 }),
      sip({ paid: true }),  // tarihsiz ama aday değil → tarihsiz sayılmaz
    ], SIMDI);
    expect(o.musteriler).toEqual([]);
    expect(o.bilinmeyen).toBe(0);
    expect(o.tarihsiz).toBe(0);
    expect(o.toplam).toBe(0);
  });

  it("müşteri adı yoksa '—' altında toplanır", () => {
    const o = arYaslandirma([sip({ customerName: undefined, gun: 1 }), sip({ customerName: '', gun: 2 })], SIMDI);
    expect(o.musteriler).toHaveLength(1);
    expect(o.musteriler[0].ad).toBe('—');
    expect(o.musteriler[0].toplam).toBe(2000);
  });

  it('tarih kaynağı createdAt ÖNCE, yoksa syncedAt (Shopify aynası); Timestamp zarfı da çözülür', () => {
    const ms = gunOnce(70).getTime();
    const o = arYaslandirma([
      sip({ customerName: 'Shopify Müşterisi', createdAt: undefined, syncedAt: gunOnce(35) }),
      sip({ customerName: 'Zarf Müşterisi', createdAt: { _seconds: Math.floor(ms / 1000), _nanoseconds: 0 } }),
      sip({ customerName: 'İkisi de var', createdAt: gunOnce(95), syncedAt: gunOnce(1) }),
    ], SIMDI);
    const ad = (n: string) => o.musteriler.find(m => m.ad === n);
    expect(ad('Shopify Müşterisi')?.kovalar.b31_60).toBe(1000);
    expect(ad('Zarf Müşterisi')?.kovalar.b61_90).toBe(1000);
    expect(ad('İkisi de var')?.kovalar.b90p).toBe(1000);   // syncedAt (1 gün) DEĞİL, createdAt (95 gün)
  });

  it('gün farkı YEREL GÜNE göre (gunFarki), ham saat farkı değil: dün 23:00 → bugün 01:00 = 1 gün', () => {
    const o = arYaslandirma([sip({ createdAt: new Date(2026, 8, 12, 23, 0) })], new Date(2026, 8, 13, 1, 0));
    expect(o.musteriler[0].enEski).toBe(1);
  });
});

describe('toplamAlacak — native kovalar + Mikro cari bakiye (cariBalanceToplam.ar)', () => {
  const ozet = arYaslandirma([sip({ gun: 10, totalPrice: 7500 }), sip({ gun: 20, totalPrice: null })], SIMDI);
  it('bilinen Mikro bakiyesiyle toplar; `bilinmeyen` sayacı geçer', () => {
    expect(toplamAlacak(ozet, 12000)).toEqual({ toplam: 19500, bilinen: 2, bilinmeyen: 1 });   // bilinen: 1 native + Mikro
  });
  it('Mikro bakiyesi bilinmiyorsa (NaN/undefined) toplam NaN — ekranda paraYaz/tlYaz "—" basar', () => {
    expect(Number.isNaN(toplamAlacak(ozet, NaN).toplam)).toBe(true);
    expect(Number.isNaN(toplamAlacak(ozet, undefined).toplam)).toBe(true);
    expect(toplamAlacak(ozet, undefined).bilinmeyen).toBe(1);
  });
  it('0 bakiye gerçek sıfırdır (state varsayılanı), toplamı bozmaz', () => {
    expect(toplamAlacak(ozet, 0).toplam).toBe(7500);
  });
});

describe('gecikmisSiparisler — Phase 178 eskalasyon listesi', () => {
  it('eşik 30 gün: tam 30 dışarıda, 31 içeride; en eski önce; seviye eklenir; girdi alanları korunur (generic)', () => {
    const r = gecikmisSiparisler([
      { id: 'a', ...sip({ gun: 30 }) },
      { id: 'b', ...sip({ gun: 31, customerName: 'Şahin İnşaat' }) },
      { id: 'c', ...sip({ gun: 95, customerName: 'Işık Yapı' }) },
      { id: 'd', ...sip({ gun: 65 }) },
    ], { simdi: SIMDI });
    expect(r.liste.map(o => [o.id, o.gecikmeGunu, o.seviye])).toEqual([['c', 95, 'L3'], ['d', 65, 'L2'], ['b', 31, 'L1']]);
    expect(r.liste[0].customerName).toBe('Işık Yapı');
    expect(r.liste[0].totalPrice).toBe(1000);
  });
  it('enFazla (varsayılan 8) ile kırpar', () => {
    const cok = Array.from({ length: 10 }, (_, i) => ({ id: String(i), ...sip({ gun: 40 + i }) }));
    expect(gecikmisSiparisler(cok, { simdi: SIMDI }).liste).toHaveLength(8);
    expect(gecikmisSiparisler(cok, { simdi: SIMDI, enFazla: 3 }).liste).toHaveLength(3);
  });
  it('tutarı bilinmeyen gecikmiş sipariş LİSTEDE KALIR (gecikme gerçektir), `tutarBilinmeyen` sayılır', () => {
    const r = gecikmisSiparisler([{ id: 'x', ...sip({ gun: 50, totalPrice: undefined }) }], { simdi: SIMDI });
    expect(r.liste).toHaveLength(1);
    expect(r.tutarBilinmeyen).toBe(1);
  });
  it('tarihsiz / çözülemeyen tarih: listeye girmez (0 güne düşmez), `tarihsiz` sayılır', () => {
    const r = gecikmisSiparisler([sip({}), sip({ createdAt: 'geçen ay' }), sip({ gun: 40 })], { simdi: SIMDI });
    expect(r.liste).toHaveLength(1);
    expect(r.tarihsiz).toBe(2);
  });
  it('ödenmiş / iptal / Mikro kaynaklı dışarıda; faturalı VARSAYILAN olarak içeride (sayfadaki 178 davranışı), faturaliHaric:true ile dışarıda', () => {
    const girdi = [
      { id: 'p', ...sip({ paid: true, gun: 50 }) }, { id: 'c', ...sip({ status: 'Cancelled', gun: 50 }) }, { id: 'm', ...sip({ source: 'mikro-siparis', paid: undefined, gun: 50 }) },
      { id: 'f', ...sip({ faturali: true, gun: 50 }) },
    ];
    expect(gecikmisSiparisler(girdi, { simdi: SIMDI }).liste.map(o => o.id)).toEqual(['f']);
    expect(gecikmisSiparisler(girdi, { simdi: SIMDI, faturaliHaric: true }).liste).toEqual([]);
  });
  it('boş liste', () => {
    expect(gecikmisSiparisler([], { simdi: SIMDI })).toEqual({ liste: [], tarihsiz: 0, tutarBilinmeyen: 0 });
  });
});

describe('ekran: kova → tlYaz (kur çevirimi TEK KAYNAK currency.ts)', () => {
  const o = arYaslandirma([sip({ gun: 100, totalPrice: 4000 })], SIMDI);
  it('kur yoksa "—" — TL tutarı $ ile basılmaz', () => {
    expect(tlYaz(o.kovalar.b90p, { birim: 'USD', rates: null, ondalik: 0 })).toBe('—');
    expect(tlYaz(o.kovalar.b90p, { birim: 'USD', rates: {}, ondalik: 0 })).toBe('—');
  });
  it('kur varsa çevirir; TRY olduğu gibi', () => {
    expect(tlYaz(o.kovalar.b90p, { birim: 'USD', rates: { USD: 40 }, ondalik: 0 })).toBe('$100');
    expect(tlYaz(o.kovalar.b90p, { birim: 'TRY', ondalik: 0 })).toBe('₺4.000');
  });
  it('bilinmeyen Mikro bakiyesiyle toplam NaN → "—"', () => {
    expect(tlYaz(toplamAlacak(o, undefined).toplam, { birim: 'TRY', ondalik: 0 })).toBe('—');
  });
});

describe('kovaTutari — kova ekran tutarı para.ts ekranTutari sözleşmesiyle (Phase 131 kartları/satırları)', () => {
  const o = arYaslandirma([
    sip({ gun: 10, totalPrice: 1000 }), sip({ gun: 12, totalPrice: null }),   // 0-30: kısmi
    sip({ gun: 40, totalPrice: null }),                                        // 31-60: hiç bilinen yok
    sip({ gun: 70, totalPrice: 250 }),                                         // 61-90: tam
  ], SIMDI);
  it('kısmi bilinmeyen kova → bilinen kısmi toplam (sayfa notu koyar); sayaçlar tutarlı', () => {
    expect(kovaTutari(o, 'b0_30')).toBe(1000);
    expect(o.kovaBilinen).toEqual({ b0_30: 1, b31_60: 0, b61_90: 1, b90p: 0 });
    expect(o.bilinen).toBe(2);
  });
  it("hiç bilinen yok → NaN ('—'); tam bilinen → toplam; boş kova gerçek 0", () => {
    expect(kovaTutari(o, 'b31_60')).toBeNaN();
    expect(kovaTutari(o, 'b61_90')).toBe(250);
    expect(kovaTutari(o, 'b90p')).toBe(0);
  });
});
