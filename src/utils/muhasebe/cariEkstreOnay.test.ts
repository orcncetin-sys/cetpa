/**
 * cariEkstreOnay.test.ts — MuhasebePage Phase 559 (Müşteri Cari Hesap Ekstresi) + Phase 560
 * (Sipariş Onay Akışı) hesap sözleşmesi. ÖNCE YAZILDI (Faz 3 1/n, 2026-09-13).
 *
 * Sahte kesinlik siteleri (sayfa ~2375-2560):
 *  - ~2386 `zamanMs(a.createdAt) ?? 0`   → tarihi bilinmeyen sipariş 1970'e düşüp ekstrenin BAŞINA geliyordu
 *  - ~2391 `custLead?.creditLimit ?? 0`   → limiti bilinmeyen müşteri "limit 0" görünüyordu
 *  - ~2397 `const amt = o.totalPrice || 0` → tutarı bilinmeyen hareket yürüyen bakiyeye ₺0 giriyordu
 *  - ~2402 `s+(o.totalPrice||0)`          → Toplam Fatura / Tahsil Edilen eksik ama kesin görünüyordu
 *  - ~2403 `.filter(o => o.paid)`         → Mikro kaynaklı kayıtta `paid` YOK → hepsi "ödenmedi" sayılıp
 *                                            Bekleyen Alacak şişiyordu (siparis.ts'teki ₺17,6M sınıfı)
 *  - ~2512 `(o.totalPrice || 0) >= esik`  → tutarı bilinmeyen Pending sipariş onay kapısından SESSİZCE geçiyordu
 * Kural (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR; ekranda '—' + not.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari } from '../para';
import {
  cariHareketleri, cariOzet, krediLimiti, krediKullanimi, onayBekleyenler,
  type EkstreSiparisi,
} from './cariEkstreOnay';

const gun = (d: number): Date => new Date(2026, 8, d); // Eylül 2026, yerel
const sip = (p: Partial<EkstreSiparisi> & { id: string }): EkstreSiparisi =>
  ({ customerName: 'Şahin İnşaat', totalPrice: 1000, paid: false, status: 'Confirmed', ...p });

describe('cariHareketleri — ekstre satırları + yürüyen bakiye', () => {
  it('boş liste → boş hareket, sayaçlar 0', () => {
    expect(cariHareketleri([])).toEqual({ hareketler: [], bilinmeyen: 0, tarihsiz: 0 });
  });

  it('tarihe göre artan sıralar; tarihi BİLİNMEYEN kayıt 1970 değil, EN SONA düşer ve sayılır', () => {
    const r = cariHareketleri([
      sip({ id: 'c', createdAt: gun(10) }),
      sip({ id: 'x' }),                              // tarih yok
      sip({ id: 'a', createdAt: gun(1) }),
      sip({ id: 'b', createdAt: '2026-09-05T10:00:00' }),
    ]);
    expect(r.hareketler.map(h => h.id)).toEqual(['a', 'b', 'c', 'x']);
    expect(r.tarihsiz).toBe(1);
    expect(r.hareketler[3].tarih).toBeNull();
    expect(r.hareketler[0].tarih?.getDate()).toBe(1);
  });

  it('yürüyen bakiye bilinen tutarları toplar; bilinmeyen tutardan sonra bakiye NaN (ekranda —)', () => {
    const r = cariHareketleri([
      sip({ id: 'a', createdAt: gun(1), totalPrice: 1500.5 }),
      sip({ id: 'b', createdAt: gun(2), totalPrice: 'bilinmiyor' }), // sayısal olmayan string → bilinmiyor
      sip({ id: 'c', createdAt: gun(3), totalPrice: 700 }),
    ]);
    expect(r.hareketler[0].bakiye).toBe(1500.5);
    expect(r.hareketler[1].tutarBilinmiyor).toBe(true);
    expect(Number.isNaN(r.hareketler[1].tutar)).toBe(true);
    expect(Number.isNaN(r.hareketler[1].bakiye)).toBe(true);
    expect(Number.isNaN(r.hareketler[2].bakiye)).toBe(true);   // sonrası da bilinmiyor
    expect(r.bilinmeyen).toBe(1);
  });

  it('undefined / null / "" / NaN tutarların HİÇBİRİ 0 sayılmaz', () => {
    const r = cariHareketleri([
      sip({ id: 'a', createdAt: gun(1), totalPrice: undefined }),
      sip({ id: 'b', createdAt: gun(2), totalPrice: null }),
      sip({ id: 'c', createdAt: gun(3), totalPrice: '' }),
      sip({ id: 'd', createdAt: gun(4), totalPrice: NaN }),
    ]);
    expect(r.bilinmeyen).toBe(4);
    expect(r.hareketler.every(h => h.tutarBilinmiyor && Number.isNaN(h.bakiye))).toBe(true);
  });

  it('sayısal string tutar bilinir ("1250.75")', () => {
    const r = cariHareketleri([sip({ id: 'a', createdAt: gun(1), totalPrice: '1250.75' })]);
    expect(r.hareketler[0].tutar).toBe(1250.75);
    expect(r.bilinmeyen).toBe(0);
  });

  it('iptal satır gösterilir ama bakiyeyi OYNATMAZ', () => {
    const r = cariHareketleri([
      sip({ id: 'a', createdAt: gun(1), totalPrice: 1000 }),
      sip({ id: 'b', createdAt: gun(2), totalPrice: 9999, status: 'Cancelled' }),
      sip({ id: 'c', createdAt: gun(3), totalPrice: 500 }),
    ]);
    expect(r.hareketler[1].iptal).toBe(true);
    expect(r.hareketler[1].bakiye).toBe(1000);
    expect(r.hareketler[2].bakiye).toBe(1500);
  });

  it('ödeme durumu: paid=true → odendi; Cetpa-native paid=false → bekliyor; Mikro kaynaklı → bilinmiyor', () => {
    const r = cariHareketleri([
      sip({ id: 'a', createdAt: gun(1), paid: true }),
      sip({ id: 'b', createdAt: gun(2), paid: false }),
      sip({ id: 'c', createdAt: gun(3), source: 'mikro-fatura' }),
      sip({ id: 'd', createdAt: gun(4), source: 'mikro-siparis', paid: false }),
    ]);
    expect(r.hareketler.map(h => h.odeme)).toEqual(['odendi', 'bekliyor', 'bilinmiyor', 'bilinmiyor']);
  });

  it('orijinal alanları korur (id, status, customerName JSX için)', () => {
    const r = cariHareketleri([sip({ id: 'ışık-1', createdAt: gun(1), status: 'Shipped', customerName: 'Işık Yapı' })]);
    expect(r.hareketler[0].id).toBe('ışık-1');
    expect(r.hareketler[0].status).toBe('Shipped');
    expect(r.hareketler[0].customerName).toBe('Işık Yapı');
  });
});

describe('cariOzet — KPI toplamları', () => {
  it('boş liste → hepsi 0, bilinmeyen 0', () => {
    expect(cariOzet([])).toEqual({
      fatura: { toplam: 0, bilinen: 0, bilinmeyen: 0 },
      tahsil: { toplam: 0, bilinen: 0, bilinmeyen: 0 },
      bekleyen: { toplam: 0, bilinen: 0, bilinmeyen: 0 },
      odemeBilinmeyen: 0,
    });
  });

  it('fatura = iptal olmayan bilinen tutarlar; tahsil = paid; bekleyen = takipli & ödenmemiş', () => {
    const o = cariOzet([
      sip({ id: 'a', totalPrice: 1000, paid: true }),
      sip({ id: 'b', totalPrice: 2500.25, paid: false }),
      sip({ id: 'c', totalPrice: 400, paid: false }),
    ]);
    expect(o.fatura).toEqual({ toplam: 3900.25, bilinen: 3, bilinmeyen: 0 });
    expect(o.tahsil).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 0 });
    expect(o.bekleyen).toEqual({ toplam: 2900.25, bilinen: 2, bilinmeyen: 0 });
    expect(o.odemeBilinmeyen).toBe(0);
  });

  it('bilinmeyen tutar toplama GİRMEZ, sayılır (undefined/null/""/NaN)', () => {
    const o = cariOzet([
      sip({ id: 'a', totalPrice: 1000, paid: false }),
      sip({ id: 'b', totalPrice: undefined, paid: false }),
      sip({ id: 'c', totalPrice: null, paid: true }),
      sip({ id: 'd', totalPrice: '', paid: false }),
      sip({ id: 'e', totalPrice: NaN, paid: true }),
    ]);
    expect(o.fatura).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 4 });
    expect(o.tahsil).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
    expect(o.bekleyen).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 2 });
  });

  it("ekran: para.ts ekranTutari TEK sözleşme — 10 siparişten 1'i tutarsız → kısmi toplam + not ('—' DEĞİL); tahsil tarafında hiç bilinen yoksa '—'", () => {
    const o = cariOzet([
      ...Array.from({ length: 9 }, (_, i) => sip({ id: `s${i}`, totalPrice: 1000, paid: true })),
      sip({ id: 'x', totalPrice: undefined, paid: true }),
    ]);
    expect(ekranTutari(o.fatura)).toBe(9000);   // Bilanço/KDV/AR yaşlandırma ile aynı davranış
    expect(o.fatura.bilinmeyen).toBe(1);        // sayfa "1 kaydın tutarı bilinmiyor" notu
    expect(ekranTutari(o.tahsil)).toBe(9000);
    expect(ekranTutari(o.bekleyen)).toBe(0);    // hiç bekleyen yok → gerçek 0
    const hicYok = cariOzet([sip({ id: 'a', totalPrice: null, paid: true }), sip({ id: 'b', totalPrice: '', paid: true })]);
    expect(ekranTutari(hicYok.fatura)).toBeNaN();
    expect(ekranTutari(hicYok.tahsil)).toBeNaN();
  });

  it('Mikro kaynaklı kayıt: faturaya girer, tahsil/bekleyene GİRMEZ, odemeBilinmeyen sayılır', () => {
    const o = cariOzet([
      sip({ id: 'a', totalPrice: 1000, paid: false }),
      sip({ id: 'm1', totalPrice: 50000, source: 'mikro-fatura' }),          // paid yok
      sip({ id: 'm2', totalPrice: 7000, source: 'mikro-siparis', paid: false }),
    ]);
    expect(o.fatura.toplam).toBe(58000);
    expect(o.tahsil.toplam).toBe(0);
    expect(o.bekleyen.toplam).toBe(1000);     // ₺57.000 "bekleyen" sahte alacak YOK
    expect(o.odemeBilinmeyen).toBe(2);
  });

  it('iptal sipariş hiçbir toplama girmez', () => {
    const o = cariOzet([
      sip({ id: 'a', totalPrice: 1000, paid: false }),
      sip({ id: 'b', totalPrice: 8000, paid: false, status: 'Cancelled' }),
      sip({ id: 'c', totalPrice: undefined, status: 'Cancelled' }),
    ]);
    expect(o.fatura).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 0 });
    expect(o.bekleyen).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 0 });
    expect(o.odemeBilinmeyen).toBe(0);
  });
});

describe('krediLimiti — bilinmeyen limit 0 DEĞİL null', () => {
  it('sayısal limit → sayı', () => {
    expect(krediLimiti({ name: 'Çelik Yapı', creditLimit: 250000 })).toBe(250000);
    expect(krediLimiti({ name: 'Çelik Yapı', creditLimit: '250000' })).toBe(250000);
  });
  it('lead yok / limit undefined / null / "" / NaN → null', () => {
    expect(krediLimiti(undefined)).toBeNull();
    expect(krediLimiti({ name: 'Çelik Yapı' })).toBeNull();
    expect(krediLimiti({ name: 'Çelik Yapı', creditLimit: null })).toBeNull();
    expect(krediLimiti({ name: 'Çelik Yapı', creditLimit: '' })).toBeNull();
    expect(krediLimiti({ name: 'Çelik Yapı', creditLimit: NaN })).toBeNull();
  });
});

describe('krediKullanimi — oran ya da null', () => {
  const ozet = (bekleyen: number, bilinmeyen = 0, odemeBilinmeyen = 0) => ({
    fatura: { toplam: bekleyen, bilinen: 1, bilinmeyen }, tahsil: { toplam: 0, bilinen: 0, bilinmeyen: 0 },
    bekleyen: { toplam: bekleyen, bilinen: 1, bilinmeyen }, odemeBilinmeyen,
  });
  it('limit 100.000, bekleyen 45.000 → %45', () => {
    expect(krediKullanimi(100000, ozet(45000))).toBe(45);
  });
  it('limit null ya da ≤ 0 → null (%0 sahte kesinliktir)', () => {
    expect(krediKullanimi(null, ozet(45000))).toBeNull();
    expect(krediKullanimi(0, ozet(45000))).toBeNull();
    expect(krediKullanimi(-5, ozet(45000))).toBeNull();
  });
  it('bekleyen tutarı bilinmeyen kayıt varsa → null', () => {
    expect(krediKullanimi(100000, ozet(45000, 1))).toBeNull();
  });
  it('tahsilatı Mikro\'da izlenen kayıt varsa → null (alacak alt sınırdır, oran değil)', () => {
    expect(krediKullanimi(100000, ozet(45000, 0, 3))).toBeNull();
  });
  it('bekleyen 0, limit var → 0 (bilinen sıfır)', () => {
    expect(krediKullanimi(100000, ozet(0))).toBe(0);
  });
});

describe('onayBekleyenler — Phase 560 yüksek tutarlı Pending siparişler', () => {
  it('boş liste → boş', () => {
    expect(onayBekleyenler([], 50000)).toEqual({ liste: [], tutarsiz: [], esikGecerli: true });
  });
  it('Pending ve tutar ≥ eşik → listede; altı ve Pending olmayan → değil', () => {
    const r = onayBekleyenler([
      sip({ id: 'a', status: 'Pending', totalPrice: 50000 }),
      sip({ id: 'b', status: 'Pending', totalPrice: 49999.99 }),
      sip({ id: 'c', status: 'Processing', totalPrice: 90000 }),
      sip({ id: 'd', status: 'Pending', totalPrice: '75000' }),
    ], 50000);
    expect(r.liste.map(o => o.id)).toEqual(['a', 'd']);
    expect(r.tutarsiz).toEqual([]);
  });
  it('tutarı bilinmeyen Pending sipariş SESSİZCE geçmez — tutarsiz listesine düşer', () => {
    const r = onayBekleyenler([
      sip({ id: 'a', status: 'Pending', totalPrice: undefined }),
      sip({ id: 'b', status: 'Pending', totalPrice: '' }),
      sip({ id: 'c', status: 'Pending', totalPrice: NaN }),
      sip({ id: 'd', status: 'Confirmed', totalPrice: null }),   // Pending değil → ilgisiz
    ], 50000);
    expect(r.liste).toEqual([]);
    expect(r.tutarsiz.map(o => o.id)).toEqual(['a', 'b', 'c']);
  });
  it('eşik geçersiz (NaN/undefined/negatif) → esikGecerli false, liste boş', () => {
    const list = [sip({ id: 'a', status: 'Pending', totalPrice: 50000 })];
    expect(onayBekleyenler(list, NaN).esikGecerli).toBe(false);
    expect(onayBekleyenler(list, undefined).esikGecerli).toBe(false);
    expect(onayBekleyenler(list, -1).esikGecerli).toBe(false);
    expect(onayBekleyenler(list, NaN).liste).toEqual([]);
  });
  it('eşik 0 → her bilinen-tutarlı Pending sipariş onaya düşer', () => {
    const r = onayBekleyenler([sip({ id: 'a', status: 'Pending', totalPrice: 1 })], 0);
    expect(r.liste.map(o => o.id)).toEqual(['a']);
  });
});
