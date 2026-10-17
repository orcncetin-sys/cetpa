/**
 * musteriAnaliz.test.ts — Pano müşteri analizi panellerinin TEK sözleşmesi
 * (Faz 3 5/n, grup "musteriAnaliz"). ÖNCE YAZILDI, kırmızı görüldü; sonra
 * `musteriAnaliz.ts` yazıldı.
 *
 * NEDEN VAR — DashboardPage.tsx'te beş panel aynı sahte kesinliği taşıyordu
 * (taşımadan önceki satır numaraları):
 *
 *  • ~1325/1334 **Phase 160 Müşteri Ödeme Davranışı**
 *      `custPay[name].totalPaid += o.totalPrice || 0;`
 *      `custUnpaid[name] = (custUnpaid[name] ?? 0) + (o.totalPrice || 0);`
 *      `Object.values(custPay).sort((a, b) => b.totalPaid - a.totalPaid)`
 *    Tutarı bilinmeyen sipariş ₺0 sayılıyor; müşteri "hiç ödeme yapmamış" gibi
 *    listenin dibine düşüyor, alacak da eksik görünüyordu.
 *
 *  • ~1467-1468 **Phase 79 B2B vs Perakende**
 *      `b2bRev = filteredOrders.filter(...).reduce((s,o) => s + (o.totalPrice || 0), 0)`
 *      `b2bPct = Math.round((b2bRev / totalRev) * 100); retailPct = 100 - b2bPct;`
 *    Yüzde, EKSİK bir toplamdan türetiliyor: tutarı okunamayan tek bir B2B siparişi
 *    payı olduğundan küçük gösteriyor ve çubuk yine de tam %100 doluyordu.
 *
 *  • ~1514-1516 **Phase 106 Müşteri Tipine Göre Halka** — aynı `|| 0` üç kez; halka
 *    dilimleri, merkez rozeti ve üç ilerleme çubuğu kısmi toplamdan çiziliyordu.
 *
 *  • ~1604 **Phase 124 Segment Kârlılığı**
 *      `segMap[type].revenue += o.totalPrice || 0;`
 *      `... (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity`
 *      `margin = s.revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 100) : 0`
 *    Maliyeti bilinmeyen kalem için **%60 uydurma maliyet oranı**; `itemCostTRY`
 *    kuru çevrilemeyen kalem için 0 döndüğü için o kalem "bedelsiz" sayılıp marjı
 *    şişiriyordu; cirosu bilinmeyen segment ise "%0 marj" kırmızı rozeti alıyordu.
 *
 *  • ~2122 **Phase 77 En İyi Müşteriler**
 *      `custMap[k].revenue += o.totalPrice || 0;` + `maxRev = top5[0].revenue` +
 *      `pct = Math.round((c.revenue / maxRev) * 100)`
 *    Ölçek çubuğu, bilinmeyeni ₺0 sayan bir tepe değere göre çiziliyordu.
 *
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur.
 */
import { describe, it, expect } from 'vitest';
import {
  odemeDavranisi,
  segmentCirosu,
  enIyiMusteriler,
  segmentKarliligi,
  tipSegmenti,
  donutSegmenti,
  b2bSegmenti,
} from './musteriAnaliz';
import { siparisKarliligi } from '../siparisler/siparisKarlilik';
import type { Order, OrderLineItem } from '../../types';

/* ── Türkçe fikstür ───────────────────────────────────────────────────────── */

const CIMENTO: OrderLineItem = { id: 'k1', sku: 'CIM-50', name: 'ÇİMENTO 50KG', price: 500, quantity: 10, costPrice: 300 };
const DEMIR: OrderLineItem = { id: 'k2', sku: 'DMR-12', name: 'NERVÜRLÜ DEMİR 12MM', price: 1200, quantity: 5, costPrice: 800 };

/**
 * Pano siparişi — kanonik `Order`ın test için GEVŞETİLMİŞ hâli:
 *  • `customerType`: kanonik tip 'B2B' | 'Retail' ama pano 'Dealer' da okuyor
 *    (DashboardPage Phase 106 `as unknown as string` ile).
 *  • `totalPrice`: gerçek veride `undefined` / `null` / okunamayan metin olabiliyor
 *    (Mikro eşlemesi, eski kayıt) — modülün asıl sınadığı hâl bu.
 */
type PanoSiparisi = Omit<Order, 'customerType' | 'totalPrice'> & { customerType?: string; totalPrice?: unknown };

const sip = (o: Partial<PanoSiparisi> = {}): PanoSiparisi => ({
  id: 'sip-1',
  customerName: 'Şirin İnşaat Ltd. Şti.',
  totalPrice: 10000,
  status: 'Delivered',
  customerType: 'B2B',
  ...o,
});

/* ────────────────────────────────────────────────────────────────────────────
 * 1) odemeDavranisi — Phase 160
 * ──────────────────────────────────────────────────────────────────────────── */

describe('odemeDavranisi — SAYFA PARİTESİ (bilinen girdide sayı eskiyle birebir)', () => {
  const siparisler: PanoSiparisi[] = [
    sip({ id: 'a', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 10000, paid: true }),
    sip({ id: 'b', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 5000, paid: true }),
    sip({ id: 'c', customerName: 'Yapı Market A.Ş.', totalPrice: 20000, paid: true }),
    sip({ id: 'd', customerName: 'Deniz Nakliyat', totalPrice: 3000, paid: true, status: 'Cancelled' }),
    sip({ id: 'e', customerName: 'Yapı Market A.Ş.', totalPrice: 7000, paid: false, status: 'Pending' }),
    sip({ id: 'f', customerName: 'Deniz Nakliyat', totalPrice: 4000, paid: false, status: 'Pending', source: 'mikro-siparis' }),
  ];

  it('en çok ödeme yapanlar: eski `+= totalPrice || 0` + azalan sıralama ile aynı', () => {
    const { odeyenler } = odemeDavranisi(siparisler);
    expect(odeyenler.map(m => [m.ad, m.tutar, m.siparisSayisi])).toEqual([
      ['Yapı Market A.Ş.', 20000, 1],
      ['Şirin İnşaat Ltd. Şti.', 15000, 2],
    ]);
    // İptal edilen sipariş (d) sayılmaz — eski blokta da `o.status === 'Cancelled'` atlanıyordu.
    expect(odeyenler.some(m => m.ad === 'Deniz Nakliyat')).toBe(false);
  });

  it('ödenmemiş alacak: yalnız Cetpa\'da izlenen (Mikro kaynaklı olmayan) siparişler', () => {
    const { borclular } = odemeDavranisi(siparisler);
    expect(borclular.map(m => [m.ad, m.tutar])).toEqual([['Yapı Market A.Ş.', 7000]]);
    // 'f' Mikro kaynaklı → odemeTakipli false → alacak listesinde YOK (tahsilat gerçeği Mikro'da).
    expect(borclular.some(m => m.ad === 'Deniz Nakliyat')).toBe(false);
  });

  it('en fazla n müşteri döner (sayfa slice(0,5) yapıyordu)', () => {
    const cok = Array.from({ length: 8 }, (_, i) =>
      sip({ id: `m${i}`, customerName: `Müşteri ${i}`, totalPrice: (i + 1) * 1000, paid: true }));
    expect(odemeDavranisi(cok).odeyenler).toHaveLength(5);
    expect(odemeDavranisi(cok, 3).odeyenler).toHaveLength(3);
  });
});

describe('odemeDavranisi — MUTASYON-AYIRT-EDİCİ (bilinmeyen 0 sayılmaz)', () => {
  it('tutarı bilinmeyen ödeme KISMİ toplama girmez, SAYILIR', () => {
    const { odeyenler } = odemeDavranisi([
      sip({ id: 'a', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 10000, paid: true }),
      sip({ id: 'g', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: undefined, paid: true }),
    ]);
    expect(odeyenler[0].tutar).toBe(10000);            // `|| 0` olsaydı yine 10000 olurdu…
    expect(odeyenler[0].siparisSayisi).toBe(2);
    expect(odeyenler[0].tutarsizSiparis).toBe(1);      // …ama bu sayaç 0 çıkardı: ekranda not yok.
  });

  it('TÜM siparişleri tutarsız olan müşteri ₺0 değil BİLİNMİYOR (NaN) ve listenin SONUNDA', () => {
    const { odeyenler } = odemeDavranisi([
      sip({ id: 'x', customerName: 'Beton Ltd.', totalPrice: undefined, paid: true }),
      sip({ id: 'y', customerName: 'Beton Ltd.', totalPrice: null, paid: true }),
      sip({ id: 'z', customerName: 'Deniz Nakliyat', totalPrice: 500, paid: true }),
    ]);
    // Eski kod: Beton = 0 → Deniz(500) üstte, Beton altta "₺0" yazıyordu (sayı UYDURMA).
    expect(odeyenler.map(m => m.ad)).toEqual(['Deniz Nakliyat', 'Beton Ltd.']);
    expect(Number.isNaN(odeyenler[1].tutar)).toBe(true);
    expect(odeyenler[1].tutarsizSiparis).toBe(2);
  });

  it('bilinmeyen tutar AZALAN sıralamada da sonda kalır (`-cmp` ile çevirme tuzağı)', () => {
    const { odeyenler } = odemeDavranisi([
      sip({ id: 'p', customerName: 'Az Ödeyen', totalPrice: 1, paid: true }),
      sip({ id: 'q', customerName: 'Tutarsız', totalPrice: 'abc', paid: true }),
      sip({ id: 'r', customerName: 'Çok Ödeyen', totalPrice: 90000, paid: true }),
    ]);
    expect(odeyenler.map(m => m.ad)).toEqual(['Çok Ödeyen', 'Az Ödeyen', 'Tutarsız']);
  });

  it('alacak tarafında da bilinmeyen 0 sayılmaz; toplam tutarsız sayacı döner', () => {
    const { borclular, borcluTutarsiz } = odemeDavranisi([
      sip({ id: 'e1', customerName: 'Yapı Market A.Ş.', totalPrice: undefined, paid: false, status: 'Pending' }),
      sip({ id: 'e2', customerName: 'Yapı Market A.Ş.', totalPrice: 7000, paid: false, status: 'Pending' }),
    ]);
    expect(borclular[0].tutar).toBe(7000);
    expect(borclular[0].tutarsizSiparis).toBe(1);
    expect(borcluTutarsiz).toBe(1);
  });

  it('adı olmayan müşteriler tek kovada toplanır (`ad === null` → ekranda \'—\')', () => {
    const { odeyenler } = odemeDavranisi([
      sip({ id: 'n1', customerName: '', totalPrice: 100, paid: true }),
      sip({ id: 'n2', customerName: '   ', totalPrice: 200, paid: true }),
    ]);
    expect(odeyenler).toHaveLength(1);
    expect(odeyenler[0].ad).toBeNull();
    expect(odeyenler[0].tutar).toBe(300);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2) segmentCirosu — Phase 79 + Phase 106
 * ──────────────────────────────────────────────────────────────────────────── */

describe('segmentCirosu — SAYFA PARİTESİ', () => {
  const siparisler: PanoSiparisi[] = [
    sip({ id: 's1', customerType: 'B2B', totalPrice: 60000 }),
    sip({ id: 's2', customerType: 'B2B', totalPrice: 40000 }),
    sip({ id: 's3', customerType: 'Dealer', totalPrice: 50000 }),
    sip({ id: 's4', customerType: 'Retail', totalPrice: 30000 }),
    sip({ id: 's5', customerType: undefined, totalPrice: 20000 }),
  ];

  it('Phase 79 (B2B vs geri kalan): yüzdeler eski `Math.round(b2bRev/totalRev*100)` ile aynı', () => {
    const r = segmentCirosu(siparisler, b2bSegmenti, ['B2B', 'Diger']);
    expect(r.toplam).toBe(200000);
    const b2b = r.segmentler[0], diger = r.segmentler[1];
    expect([b2b.anahtar, b2b.ciro]).toEqual(['B2B', 100000]);
    expect([diger.anahtar, diger.ciro]).toEqual(['Diger', 100000]);
    expect(r.yuzdelerGecerli).toBe(true);
    expect(Math.round(b2b.yuzde as number)).toBe(50);
    // Sayfa `retailPct = 100 - b2bPct` yapıyor; ham yüzde de 50.
    expect(Math.round(diger.yuzde as number)).toBe(50);
  });

  it('Phase 106 (B2B / Bayi / Perakende): sıra SABİT, en büyük segment ve yüzdeler eskiyle aynı', () => {
    const r = segmentCirosu(siparisler, donutSegmenti, ['B2B', 'Dealer', 'Retail']);
    expect(r.segmentler.map(s => [s.anahtar, s.ciro])).toEqual([
      ['B2B', 100000], ['Dealer', 50000], ['Retail', 50000],
    ]);
    expect(r.segmentler.map(s => Math.round(s.yuzde as number))).toEqual([50, 25, 25]);
    expect(r.enBuyuk?.anahtar).toBe('B2B');
    expect(Math.round(r.enBuyuk?.yuzde as number)).toBe(50);
  });

  it('siparişi olmayan segment gerçek ₺0 (boş liste) — sayfa `rev > 0` ile eliyordu', () => {
    const r = segmentCirosu(
      [sip({ id: 't1', customerType: 'B2B', totalPrice: 1000 })],
      donutSegmenti, ['B2B', 'Dealer', 'Retail'],
    );
    expect(r.segmentler.map(s => [s.anahtar, s.ciro, s.siparisSayisi])).toEqual([
      ['B2B', 1000, 1], ['Dealer', 0, 0], ['Retail', 0, 0],
    ]);
    expect(r.segmentler[1].yuzde).toBe(0);
  });
});

describe('segmentCirosu — MUTASYON-AYIRT-EDİCİ (kısmi toplamdan pay yüzdesi TÜRETİLMEZ)', () => {
  it('tek sipariş bile tutarsızsa hiçbir segmentin yüzdesi hesaplanmaz', () => {
    const r = segmentCirosu([
      sip({ id: 'a', customerType: 'B2B', totalPrice: 100000 }),
      sip({ id: 'b', customerType: 'Retail', totalPrice: undefined }),
    ], b2bSegmenti, ['B2B', 'Diger']);

    // Eski kod: totalRev = 100000 → "B2B %100 / Perakende %0", çubuk tamamen mavi.
    expect(r.yuzdelerGecerli).toBe(false);
    expect(r.segmentler.map(s => s.yuzde)).toEqual([null, null]);
    expect(r.toplam).toBe(100000);        // EKRAN toplamı kısmi kalır…
    expect(r.tutarsiz).toBe(1);           // …ve "1 kayıt tutarsız" notu için sayılır.
    expect(Number.isNaN(r.tamToplam)).toBe(true);
  });

  it('segmentin KENDİ cirosu kısmi olsa da ekran toplamı kısmi verilir, yüzde verilmez', () => {
    const r = segmentCirosu([
      sip({ id: 'a', customerType: 'B2B', totalPrice: 60000 }),
      sip({ id: 'b', customerType: 'B2B', totalPrice: undefined }),
      sip({ id: 'c', customerType: 'Retail', totalPrice: 40000 }),
    ], b2bSegmenti, ['B2B', 'Diger']);
    expect(r.segmentler[0].ciro).toBe(60000);
    expect(r.segmentler[0].tutarsiz).toBe(1);
    expect(r.segmentler[0].yuzde).toBeNull();
  });

  it('hiç bilinen tutar yoksa toplam ₺0 değil BİLİNMİYOR (NaN → ekranda \'—\')', () => {
    const r = segmentCirosu([
      sip({ id: 'a', customerType: 'B2B', totalPrice: undefined }),
      sip({ id: 'b', customerType: 'Retail', totalPrice: 'abc' }),
    ], b2bSegmenti, ['B2B', 'Diger']);
    expect(Number.isNaN(r.toplam)).toBe(true);
    expect(r.yuzdelerGecerli).toBe(false);
    expect(r.enBuyuk).toBeNull();          // merkez rozeti çizilmez
  });

  it('boş liste gerçek ₺0 (hareketsiz dönem), NaN değil; yüzde yine yok', () => {
    const r = segmentCirosu([], b2bSegmenti, ['B2B', 'Diger']);
    expect(r.toplam).toBe(0);
    expect(r.tamToplam).toBe(0);
    expect(r.yuzdelerGecerli).toBe(false);  // 0'a bölme yok
    expect(r.segmentler.map(s => s.yuzde)).toEqual([null, null]);
  });

  it('anahtar listesi verilmezse bulunan segmentler azalan ciroya göre sıralanır', () => {
    const r = segmentCirosu([
      sip({ id: 'a', customerType: 'Retail', totalPrice: 10 }),
      sip({ id: 'b', customerType: 'B2B', totalPrice: 90 }),
    ], tipSegmenti);
    expect(r.segmentler.map(s => s.anahtar)).toEqual(['B2B', 'Retail']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3) enIyiMusteriler — Phase 77
 * ──────────────────────────────────────────────────────────────────────────── */

describe('enIyiMusteriler — SAYFA PARİTESİ', () => {
  const siparisler: PanoSiparisi[] = [
    sip({ id: 'a', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 10000 }),
    sip({ id: 'b', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 5000 }),
    sip({ id: 'c', customerName: 'Yapı Market A.Ş.', totalPrice: 20000 }),
    sip({ id: 'd', customerName: 'Deniz Nakliyat', totalPrice: 3000 }),
  ];

  it('ilk 5 müşteri, ciro + sipariş adedi + çubuk oranı eskiyle birebir', () => {
    const { musteriler } = enIyiMusteriler(siparisler, 5);
    expect(musteriler.map(m => [m.ad, m.ciro, m.siparisSayisi])).toEqual([
      ['Yapı Market A.Ş.', 20000, 1],
      ['Şirin İnşaat Ltd. Şti.', 15000, 2],
      ['Deniz Nakliyat', 3000, 1],
    ]);
    // Eski: pct = Math.round((c.revenue / maxRev) * 100) — maxRev = top5[0].revenue
    expect(musteriler.map(m => Math.round(m.barOrani as number))).toEqual([100, 75, 15]);
  });

  it('n ile kesilir (sayfa slice(0,5))', () => {
    expect(enIyiMusteriler(siparisler, 2).musteriler.map(m => m.ad))
      .toEqual(['Yapı Market A.Ş.', 'Şirin İnşaat Ltd. Şti.']);
  });

  it('iptal edilen siparişler DE sayılır — Phase 77 bloğu onları elemiyordu', () => {
    const { musteriler } = enIyiMusteriler([
      sip({ id: 'a', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 1000, status: 'Cancelled' }),
    ], 5);
    expect(musteriler[0].ciro).toBe(1000);
  });
});

describe('enIyiMusteriler — MUTASYON-AYIRT-EDİCİ', () => {
  it('tutarı bilinmeyen müşteri ₺0 sayılıp ortaya dizilmez, SONA gider', () => {
    const { musteriler } = enIyiMusteriler([
      sip({ id: 'a', customerName: 'Tutarsız Ltd.', totalPrice: undefined }),
      sip({ id: 'b', customerName: 'Deniz Nakliyat', totalPrice: 3000 }),
    ], 5);
    expect(musteriler.map(m => m.ad)).toEqual(['Deniz Nakliyat', 'Tutarsız Ltd.']);
    expect(Number.isNaN(musteriler[1].ciro)).toBe(true);
    expect(musteriler[1].barOrani).toBeNull();   // eski: NaN genişlik → çubuk bozuk
  });

  it('ÖLÇEK müşterisinin (en tepedeki) cirosu kısmiyse HİÇBİR çubuk çizilmez', () => {
    const { musteriler, olcekGecerli } = enIyiMusteriler([
      sip({ id: 'a', customerName: 'Yapı Market A.Ş.', totalPrice: 20000 }),
      sip({ id: 'a2', customerName: 'Yapı Market A.Ş.', totalPrice: undefined }),
      sip({ id: 'b', customerName: 'Deniz Nakliyat', totalPrice: 3000 }),
    ], 5);
    // Eski kod maxRev = 20000 sanıp Deniz'i %15 çiziyordu; gerçek tepe bilinmiyor.
    expect(olcekGecerli).toBe(false);
    expect(musteriler.map(m => m.barOrani)).toEqual([null, null]);
    expect(musteriler[0].ciro).toBe(20000);
    expect(musteriler[0].tutarsizSiparis).toBe(1);
  });

  it('ölçek yokken BİLİNEN ₺0 müşteri boş ray (0) alır, pozitifler null kalır (6b inceleme 2026-09-25)', () => {
    const { musteriler, olcekGecerli } = enIyiMusteriler([
      sip({ id: 'a', customerName: 'Yapı Market A.Ş.', totalPrice: 20000 }),
      sip({ id: 'a2', customerName: 'Yapı Market A.Ş.', totalPrice: undefined }),
      sip({ id: 'b', customerName: 'Deniz Nakliyat', totalPrice: 3000 }),
      sip({ id: 'c', customerName: 'Numune Cari', totalPrice: 0 }),
    ], 5);
    expect(olcekGecerli).toBe(false);
    expect(musteriler.map(m => m.barOrani)).toEqual([null, null, 0]);
  });

  it('kısmi cirolu ALT satırın çubuğu çizilmez, ölçek geçerli olsa bile', () => {
    const { musteriler, olcekGecerli } = enIyiMusteriler([
      sip({ id: 'a', customerName: 'Yapı Market A.Ş.', totalPrice: 20000 }),
      sip({ id: 'b', customerName: 'Deniz Nakliyat', totalPrice: 3000 }),
      sip({ id: 'b2', customerName: 'Deniz Nakliyat', totalPrice: null }),
    ], 5);
    expect(olcekGecerli).toBe(true);
    expect(Math.round(musteriler[0].barOrani as number)).toBe(100);
    expect(musteriler[1].barOrani).toBeNull();
  });

  it('adsız siparişler tek kovada (eski kod "undefined" adlı sahte müşteri üretiyordu)', () => {
    const { musteriler } = enIyiMusteriler([
      sip({ id: 'a', customerName: '', totalPrice: 100 }),
      sip({ id: 'b', customerName: '', totalPrice: 200 }),
    ], 5);
    expect(musteriler).toHaveLength(1);
    expect(musteriler[0].ad).toBeNull();
    expect(musteriler[0].ciro).toBe(300);
  });

  it('boş listede müşteri yok, ölçek geçersiz', () => {
    const r = enIyiMusteriler([], 5);
    expect(r.musteriler).toEqual([]);
    expect(r.olcekGecerli).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4) segmentKarliligi — Phase 124
 * ──────────────────────────────────────────────────────────────────────────── */

/** Sayfanın geçeceği kâr çözücüsü: kalemin kendi maliyeti yoksa stok kartından (burada sabit). */
const karHesapla = (kartMaliyeti?: (satir: OrderLineItem) => unknown) =>
  (o: PanoSiparisi) => siparisKarliligi<OrderLineItem>(o, kartMaliyeti);

describe('segmentKarliligi — SAYFA PARİTESİ', () => {
  const b2bSiparis = sip({
    id: 'a', customerType: 'B2B', totalPrice: 11000,
    lineItems: [{ ...CIMENTO }, { ...DEMIR }],
  });
  const perakendeSiparis = sip({
    id: 'b', customerType: 'Retail', totalPrice: 5000,
    lineItems: [{ ...CIMENTO }],
  });

  it('segmentler azalan ciroya göre; ciro/adet/marj eski blokla aynı', () => {
    const r = segmentKarliligi([b2bSiparis, perakendeSiparis], tipSegmenti, karHesapla());
    expect(r.segmentler.map(s => [s.anahtar, s.ciro, s.siparisSayisi])).toEqual([
      ['B2B', 11000, 1],
      ['Retail', 5000, 1],
    ]);
    // Eski: margin = Math.round(((revenue - cogs) / revenue) * 100)
    //  B2B    → (11000 - 7000) / 11000 = %36,36 → 36
    //  Retail → (5000 - 3000) / 5000   = %40
    expect(r.segmentler.map(s => Math.round(s.marjYuzde as number))).toEqual([36, 40]);
    expect(r.segmentler.map(s => s.maliyet)).toEqual([7000, 3000]);
    expect(r.segmentler.map(s => s.kar)).toEqual([4000, 2000]);
  });

  it('ortalama sipariş tutarı = ciro / adet (eski avgOrder)', () => {
    const r = segmentKarliligi([
      b2bSiparis,
      sip({ id: 'a2', customerType: 'B2B', totalPrice: 5000, lineItems: [{ ...CIMENTO }] }),
    ], tipSegmenti, karHesapla());
    expect(r.segmentler[0].ortalamaSiparis).toBe(8000);
  });

  it('çubuk oranı en büyük ciroya göre (eski `(s.revenue / maxRev) * 100`)', () => {
    const r = segmentKarliligi([b2bSiparis, perakendeSiparis], tipSegmenti, karHesapla());
    expect(r.segmentler.map(s => Math.round(s.barOrani as number)))
      .toEqual([100, Math.round((5000 / 11000) * 100)]);
  });

  it('iptal edilen sipariş segmente girmez (eski blok `continue` ediyordu)', () => {
    const r = segmentKarliligi([
      b2bSiparis,
      sip({ id: 'x', customerType: 'B2B', totalPrice: 999999, status: 'Cancelled', lineItems: [{ ...CIMENTO }] }),
    ], tipSegmenti, karHesapla());
    expect(r.segmentler[0].ciro).toBe(11000);
    expect(r.segmentler[0].siparisSayisi).toBe(1);
  });

  it('`customerType` boşsa segment "Retail" (eski `o.customerType || \'Retail\'`)', () => {
    const r = segmentKarliligi(
      [sip({ id: 'y', customerType: undefined, totalPrice: 5000, lineItems: [{ ...CIMENTO }] })],
      tipSegmenti, karHesapla(),
    );
    expect(r.segmentler[0].anahtar).toBe('Retail');
  });
});

describe('segmentKarliligi — MUTASYON-AYIRT-EDİCİ (maliyet bilinmiyorsa marj YOK)', () => {
  it('%60 UYDURMA maliyet oranı kalktı: maliyeti bilinmeyen kalemde marj hesaplanmaz', () => {
    const maliyetsiz: OrderLineItem = { id: 'k3', sku: 'KUM-01', name: 'YIKANMIŞ KUM', price: 100, quantity: 10 };
    const r = segmentKarliligi(
      [sip({ id: 'a', customerType: 'B2B', totalPrice: 1000, lineItems: [maliyetsiz] })],
      tipSegmenti,
      karHesapla(() => null),   // stok kartı da bilmiyor
    );
    // Eski kod: cogs = 100 * 0.6 * 10 = 600 → "%40 marj" yeşil rozeti (hiçbir veriye dayanmıyor).
    expect(r.segmentler[0].marjYuzde).toBeNull();
    expect(Number.isNaN(r.segmentler[0].maliyet)).toBe(true);
    expect(Number.isNaN(r.segmentler[0].kar)).toBe(true);
    expect(r.segmentler[0].maliyetsizSiparis).toBe(1);
    expect(r.segmentler[0].ciro).toBe(1000);   // ciro yine gösterilir
  });

  it('KARIŞIK segment: tek siparişin maliyeti bilinmiyorsa segment marjı üretilmez', () => {
    const maliyetsiz: OrderLineItem = { id: 'k3', sku: 'KUM-01', name: 'YIKANMIŞ KUM', price: 100, quantity: 10 };
    const r = segmentKarliligi([
      sip({ id: 'a', customerType: 'B2B', totalPrice: 11000, lineItems: [{ ...CIMENTO }, { ...DEMIR }] }),
      sip({ id: 'b', customerType: 'B2B', totalPrice: 1000, lineItems: [maliyetsiz] }),
    ], tipSegmenti, karHesapla(() => null));
    expect(r.segmentler[0].marjYuzde).toBeNull();
    expect(r.segmentler[0].maliyetsizSiparis).toBe(1);
    expect(r.segmentler[0].ciro).toBe(12000);
  });

  it('stok kartından çözülen maliyet MEŞRU 0 olabilir (promosyon) — marj %100', () => {
    const bedelsiz: OrderLineItem = { id: 'k4', sku: 'NUM-01', name: 'NUMUNE ÇİMENTO', price: 100, quantity: 10 };
    const r = segmentKarliligi(
      [sip({ id: 'a', customerType: 'B2B', totalPrice: 1000, lineItems: [bedelsiz] })],
      tipSegmenti, karHesapla(() => 0),
    );
    expect(r.segmentler[0].marjYuzde).toBe(100);
  });

  it('cirosu bilinmeyen segment "%0 marj" almaz (eski `revenue > 0 ? … : 0`)', () => {
    const r = segmentKarliligi(
      [sip({ id: 'a', customerType: 'B2B', totalPrice: undefined, lineItems: [] })],
      tipSegmenti, karHesapla(),
    );
    expect(r.segmentler[0].marjYuzde).toBeNull();
    expect(Number.isNaN(r.segmentler[0].ciro)).toBe(true);
    expect(r.segmentler[0].tutarsizSiparis).toBe(1);
  });

  it('kalemi olmayan sipariş "maliyetsiz" değil, MALİYETİ BİLİNMİYOR → marj yok', () => {
    const r = segmentKarliligi(
      [sip({ id: 'a', customerType: 'B2B', totalPrice: 5000, lineItems: [] })],
      tipSegmenti, karHesapla(),
    );
    // Eski kod: (o.lineItems || []).reduce(..., 0) → cogs 0 → "%100 marj".
    expect(r.segmentler[0].marjYuzde).toBeNull();
    expect(r.segmentler[0].ciro).toBe(5000);
  });

  it('ortalama sipariş TÜRETMEDİR: tek tutar bile bilinmiyorsa hesaplanmaz', () => {
    const r = segmentKarliligi([
      sip({ id: 'a', customerType: 'B2B', totalPrice: 10000, lineItems: [{ ...CIMENTO }] }),
      sip({ id: 'b', customerType: 'B2B', totalPrice: undefined, lineItems: [{ ...CIMENTO }] }),
    ], tipSegmenti, karHesapla());
    // Eski: avgOrder = 10000 / 2 = 5000 — ikinci siparişi ₺0 sayan bir ortalama.
    expect(r.segmentler[0].ortalamaSiparis).toBeNull();
    expect(r.segmentler[0].ciro).toBe(10000);
    expect(r.segmentler[0].tutarsizSiparis).toBe(1);
  });

  it('EN BÜYÜK segmentin cirosu kısmiyse hiçbir çubuk çizilmez', () => {
    const r = segmentKarliligi([
      sip({ id: 'a', customerType: 'B2B', totalPrice: 20000, lineItems: [{ ...CIMENTO }] }),
      sip({ id: 'a2', customerType: 'B2B', totalPrice: undefined, lineItems: [{ ...CIMENTO }] }),
      sip({ id: 'b', customerType: 'Retail', totalPrice: 3000, lineItems: [{ ...CIMENTO }] }),
    ], tipSegmenti, karHesapla());
    expect(r.olcekGecerli).toBe(false);
    expect(r.segmentler.map(s => s.barOrani)).toEqual([null, null]);
  });

  it('boş listede segment yok (sayfa `segs.length === 0` ile null dönüyordu)', () => {
    const r = segmentKarliligi([], tipSegmenti, karHesapla());
    expect(r.segmentler).toEqual([]);
    expect(r.olcekGecerli).toBe(false);
  });
});

/**
 * MARJ TABANI — mutasyon boşluğu kapatıldı (2026-09-19 hakem turu).
 *
 * Yukarıdaki fikstürlerin HEPSİNDE başlık tutarı (`totalPrice`) kalem toplamına EŞİTTİ
 * (11000 = 5000 + 6000; 5000 = 5000). Bu yüzden marjın paydasını kalem cirosu yerine
 * başlık tutarı yapan mutant (`(kar / tam) * 100`) 40/40 testi YEŞİL geçiyordu — modül
 * başlığı "kârın iki tarafı aynı tabanda olmak zorundadır" dediği hâlde bunu sabitleyen
 * tek bir test yoktu. Aşağıdaki iki fikstürde başlık ≠ kalem toplamı.
 *
 * PARİTE NOTU (görünür değişiklik): eski ekran marjı başlık tutarından hesaplıyordu
 * ((ciro − maliyet) / başlık). Mikro faturasından türeyen siparişte başlık KDV DAHİLdir
 * (eslemeFatura.ts), net maliyetle kıyaslanınca marj ~KDV oranı kadar şişiyordu. Yeni
 * ekran kalem tabanını kullanır: aynı siparişte gösterilen marj DEĞİŞİR (aşağıdaki
 * fikstürde %33,3 → %20) — bu beklenen bir değişikliktir, gerileme değil.
 */
describe('segmentKarliligi — MARJ PAYDASI KALEM CİROSUDUR (başlık tutarı değil)', () => {
  /** Başlık ₺120.000 (KDV + nakliye dâhil), kalem toplamı ₺100.000, maliyet ₺80.000. */
  const kalemTam: OrderLineItem = { id: 'k9', sku: 'CIM-50', name: 'ÇİMENTO 50KG', price: 1000, quantity: 100, costPrice: 800 };

  it('başlık kalem toplamından BÜYÜKSE marj yine kalem tabanında (%20, %16,7 değil)', () => {
    const r = segmentKarliligi(
      [sip({ id: 'a', customerType: 'B2B', totalPrice: 120000, lineItems: [{ ...kalemTam }] })],
      tipSegmenti, karHesapla(),
    );
    const b2b = r.segmentler[0];
    // EKRAN cirosu başlık tutarıdır (Phase 79/106/77 ile aynı taban — parite).
    expect(b2b.ciro).toBe(120000);
    expect(b2b.maliyet).toBe(80000);
    expect(b2b.kar).toBe(20000);
    // Payda kalem cirosu: (100000 − 80000) / 100000 = %20.
    // Payda başlık olsaydı 20000 / 120000 = %16,67 çıkardı (mutasyon-ayırt-edici).
    expect(b2b.marjYuzde).toBeCloseTo(20, 9);
  });

  it('başlığı BİLİNMEYEN ama kalemleri tam sipariş: ciro "—" ama marj yine hesaplanır', () => {
    const r = segmentKarliligi(
      [sip({ id: 'a', customerType: 'B2B', totalPrice: undefined, lineItems: [{ ...kalemTam }] })],
      tipSegmenti, karHesapla(),
    );
    const b2b = r.segmentler[0];
    expect(Number.isNaN(b2b.ciro)).toBe(true);       // ekranda '—'
    expect(b2b.tutarsizSiparis).toBe(1);
    expect(b2b.ortalamaSiparis).toBeNull();          // TÜRETME: başlık bilinmiyor
    // Kalem tabanı sağlam olduğu için marj BİLİNİR. Payda başlık olsaydı NaN%
    // rozeti basılırdı (mutasyon-ayırt-edici).
    expect(b2b.marjYuzde).toBeCloseTo(20, 9);
    expect(b2b.kar).toBe(20000);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5) Segment anahtarları + kanonik `Order` uyumu
 * ──────────────────────────────────────────────────────────────────────────── */

describe('segment anahtarları', () => {
  it('tipSegmenti: boş/boşluk/metin olmayan → Retail; diğer değer AYNEN korunur', () => {
    expect(tipSegmenti({ customerType: 'B2B' })).toBe('B2B');
    expect(tipSegmenti({ customerType: 'Dealer' })).toBe('Dealer');
    expect(tipSegmenti({ customerType: '' })).toBe('Retail');
    expect(tipSegmenti({ customerType: '   ' })).toBe('Retail');
    expect(tipSegmenti({})).toBe('Retail');
    expect(tipSegmenti({ customerType: 42 })).toBe('Retail');
    expect(tipSegmenti({ customerType: 'Toptan' })).toBe('Toptan');
  });

  it('donutSegmenti üç kovaya indirger, b2bSegmenti ikiye', () => {
    expect(donutSegmenti({ customerType: 'Toptan' })).toBe('Retail');
    expect(donutSegmenti({ customerType: 'Dealer' })).toBe('Dealer');
    expect(b2bSegmenti({ customerType: 'Dealer' })).toBe('Diger');
    expect(b2bSegmenti({ customerType: 'B2B' })).toBe('B2B');
  });
});

describe('kanonik Order dizisi kabul edilir (yapısal tip kontrolü)', () => {
  it('Order[] ile derlenir ve çalışır', () => {
    const emirler: Order[] = [
      { id: 'o1', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 1000, status: 'Delivered', customerType: 'B2B', paid: true },
      { id: 'o2', customerName: 'Yapı Market A.Ş.', totalPrice: 2000, status: 'Pending', customerType: 'Retail' },
    ];
    expect(enIyiMusteriler(emirler, 5).musteriler[0].ad).toBe('Yapı Market A.Ş.');
    expect(segmentCirosu(emirler, b2bSegmenti, ['B2B', 'Diger']).toplam).toBe(3000);
    expect(odemeDavranisi(emirler).odeyenler[0].tutar).toBe(1000);
    expect(segmentKarliligi(emirler, tipSegmenti, karHesapla()).segmentler).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6c EKİ (2026-10-17, Faz 3 6/n Genel II) — `odemeYontemiSegmenti` (O3) + `segmentCirosu` 4 parametreli biçim (O10, O22)
//   GenelBloklar2 P249 «Ödeme Yöntemi»:
//     `const method = (m.paymentMethod as string) || (m.payment as string) || (oc(currentLanguage).belirtilmemis);`
//       → `payment` HAYALET alan (yazıcısı yok); anahtar ÇEVRİLMİŞ metin (dil değişince anahtar değişir)
//     `methodMap[method].rev += o.totalPrice || 0;`                 → tutarı bilinmeyen sipariş ₺0
//     `totalRev249 > 0 ? Math.round((d.rev / totalRev249) * 100) : 0` → pay KISMİ toplamdan; `: 0` sahte "%0"
//   GenelBloklar4 P495 «Kategori» / P238 «Şehir»:
//     `const cat = li.category || 'Other';` + `(li.price || li.unitPrice || 0) * (li.quantity || 1)`
//       → hayalet kalem alanı, uydurma 'Other' kategorisi, `|| 0` / `|| 1` uydurması
//     `if (!city) return;`                                           → şehri olmayan sipariş SESSİZCE düşüyor
// Kural: bilinmeyen sayı 0 DEĞİL bilinmiyordur; anahtarsız kayıt uydurma segment OLMAZ, SAYILIR.
// O21: TRY dışı mağaza siparişi (`dovizTutar` + `paraBirimi`, `totalPrice` YOK) bu yardımcılara ULAŞMAZ — ayrım ÇAĞIRANDA.
// ═══════════════════════════════════════════════════════════════════════════════════════════
import {
  odemeYontemiSegmenti,
  ODEME_YONTEMI_BELIRTILMEMIS,
  type OdemeYontemliSiparis,
  type SegmentCiroSecenek,
} from './musteriAnaliz';
import { ODEME_YONTEMLERI } from '../siparisler/odemeYontemi';
import { tryDisiMi } from '../siparisler/magazaSiparisi';
import { siparisTutari, siparisIptalMi } from '../siparis';
import { kalemTutari } from './stokSevkiyat';
import { stokKartiCozucu } from './raporMarj';

/**
 * O21 ortak fikstürü — TRY dışı çevrim içi mağaza siparişi. Sunucu TRY dışı siparişe `totalPrice` YAZMAZ
 * (server/kanal/shopifyEsleme tutar yazımı); tutar `dovizTutar` + `paraBirimi`ndedir. Mağaza siparişi `paid: true`
 * yazar ama `paymentMethod` YAZMAZ.
 */
const DOVIZLI: PanoSiparisi = {
  id: 'shp-1001',
  source: 'shopify_webhook',
  paraBirimi: 'EUR',
  dovizTutar: 50,
  customerName: 'Kaya Hırdavat',
  status: 'Delivered',
  createdAt: new Date(2026, 8, 10),
  paid: true,
};

/** Çağıran (bağlama) reçetesi — O21 / ÖN KOŞUL: K2 iptal süzgeci, sonra `tryDisiMi` ayrımı (TEK tanım, kopyalanmaz). */
function cagiranReceti<T extends PanoSiparisi | KalemliSiparis>(orders: readonly T[]): { tl: T[]; dovizli: number } {
  const iptalsiz = orders.filter(o => !siparisIptalMi(o));
  return { tl: iptalsiz.filter(o => !tryDisiMi(o)), dovizli: iptalsiz.filter(tryDisiMi).length };
}

describe('odemeYontemiSegmenti — 6c eki (O3)', () => {
  it('fikstür kilidi: DOVIZLI siparişte `totalPrice` alanı YOK (TRY dışı mağaza yazımı)', () => {
    expect('totalPrice' in DOVIZLI).toBe(false);
    expect(tryDisiMi(DOVIZLI)).toBe(true);
  });

  it('1 · listenin HER üyesi AYNEN döner — liste testte de KOPYALANMAZ; sentinel listeye karışmaz', () => {
    expect(ODEME_YONTEMLERI.length).toBeGreaterThan(0);
    for (const y of ODEME_YONTEMLERI) expect(odemeYontemiSegmenti({ paymentMethod: y })).toBe(y);
    expect(ODEME_YONTEMLERI).not.toContain(ODEME_YONTEMI_BELIRTILMEMIS);
  });

  it('2 · bilinmeyen / boş / listede olmayan → sentinel (büyük-küçük harf toleransı YOK — yazıcı enum yazar)', () => {
    const bilinmeyenler: OdemeYontemliSiparis[] = [
      {}, { paymentMethod: null }, { paymentMethod: undefined }, { paymentMethod: '' }, { paymentMethod: '   ' },
      { paymentMethod: 42 }, { paymentMethod: { tur: 'cash' } }, { paymentMethod: 'havale' }, { paymentMethod: 'Cash' },
    ];
    for (const o of bilinmeyenler) expect(odemeYontemiSegmenti(o)).toBe(ODEME_YONTEMI_BELIRTILMEMIS);
  });

  it('3 · hayalet alanlar (`payment`, `payment_method`) ve serbest metin `shopifyRaw.odemeYontemi` OKUNMAZ', () => {
    // `OdemeYontemliSiparis` zayıf tiptir: ortak alanı olmayan nesne TS2559 verir — fikstür kesişim tipiyle kurulur.
    const hayaletler: (OdemeYontemliSiparis & Record<string, unknown>)[] = [
      { payment: 'cash' },
      { payment_method: 'check' },
      { shopifyRaw: { odemeYontemi: 'Kredi Kartı' } },
      { shopifyRaw: { odemeYontemi: 'cash' } },
    ];
    for (const h of hayaletler) expect(odemeYontemiSegmenti(h)).toBe(ODEME_YONTEMI_BELIRTILMEMIS);
  });

  it("4 · gerçek 'other' kendi satırıdır — «belirtilmemiş» ile BİRLEŞMEZ", () => {
    expect(odemeYontemiSegmenti({ paymentMethod: 'other' })).toBe('other');
    expect(odemeYontemiSegmenti({ paymentMethod: 'other' })).not.toBe(ODEME_YONTEMI_BELIRTILMEMIS);
  });

  it("5 · kırpma: ' cash ' → 'cash'", () => {
    expect(odemeYontemiSegmenti({ paymentMethod: ' cash ' })).toBe('cash');
    expect(odemeYontemiSegmenti({ paymentMethod: '\tbank_transfer\n' })).toBe('bank_transfer');
  });

  it('6 · PARİTE: segmentCirosu ile anahtar / sipariş sayısı / tutar / pay eski `methodMap` ile BİREBİR', () => {
    const x: PanoSiparisi[] = [
      sip({ id: 'p1', paymentMethod: 'cash', totalPrice: 4000 }),
      sip({ id: 'p2', paymentMethod: 'bank_transfer', totalPrice: 3000, customerName: 'Çelik Yapı A.Ş.' }),
      sip({ id: 'p3', paymentMethod: 'cash', totalPrice: 2000, customerName: 'Ege Beton' }),
      sip({ id: 'p4', totalPrice: 1000, customerName: 'Deniz İnşaat' }),                    // yöntem girilmemiş
    ];
    // GB2 P249'un ESKİ formülü test içinde yeniden yazıldı (anahtar sentinel — eskisi çevrilmiş etiketti).
    const methodMap: Record<string, { rev: number; count: number }> = {};
    for (const o of x) {
      const method = (o.paymentMethod as string) || ODEME_YONTEMI_BELIRTILMEMIS;
      if (!methodMap[method]) methodMap[method] = { rev: 0, count: 0 };
      methodMap[method].rev += Number(o.totalPrice) || 0;
      methodMap[method].count++;
    }
    const eski = Object.entries(methodMap).sort(([, a], [, b]) => b.rev - a.rev);
    const totalRev249 = eski.reduce((t, [, d]) => t + d.rev, 0);

    const r = segmentCirosu(x, odemeYontemiSegmenti);
    expect(r.segmentler.map(s => s.anahtar)).toEqual(['cash', 'bank_transfer', 'belirtilmemis']);
    expect(r.segmentler.map(s => s.anahtar)).toEqual(eski.map(([k]) => k));
    expect(r.segmentler.map(s => s.ciro)).toEqual(eski.map(([, d]) => d.rev));
    expect(r.segmentler.map(s => s.siparisSayisi)).toEqual(eski.map(([, d]) => d.count));
    const yuzdeler = r.segmentler.map(s => Math.round(s.yuzde as number));
    expect(yuzdeler).toEqual([60, 30, 10]);
    expect(yuzdeler).toEqual(eski.map(([, d]) => Math.round((d.rev / totalRev249) * 100)));
    expect(yuzdeler.reduce((t, v) => t + v, 0)).toBe(100);
    expect(r.tutarsiz).toBe(0);
  });

  it('7 · MUTASYON-AYIRT EDİCİ: tutarı bilinmeyen sipariş ₺0 SAYILMAZ — paylar üretilmez', () => {
    const r = segmentCirosu([
      sip({ id: 'q1', paymentMethod: 'cash', totalPrice: 6000 }),
      sip({ id: 'q2', paymentMethod: 'bank_transfer', totalPrice: undefined }),   // tutarı OKUNAMADI
    ], odemeYontemiSegmenti);
    expect(r.yuzdelerGecerli).toBe(false);
    expect(r.segmentler.every(s => s.yuzde === null)).toBe(true);
    expect(r.tutarsiz).toBe(1);
    expect(r.segmentler.find(s => s.anahtar === 'bank_transfer')?.tutarsiz).toBe(1);
  });

  it('8 · kanonik Order[] kabul edilir (yapısal tip — `as` yok)', () => {
    const emirler: Order[] = [
      { id: 'o1', customerName: 'Şirin İnşaat Ltd. Şti.', totalPrice: 1500, status: 'Delivered', customerType: 'B2B', paymentMethod: 'check' },
      { id: 'o2', customerName: 'Yapı Market A.Ş.', totalPrice: 500, status: 'Pending', customerType: 'Retail' },
    ];
    expect(odemeYontemiSegmenti(emirler[0])).toBe('check');
    expect(segmentCirosu(emirler, odemeYontemiSegmenti).segmentler.map(s => s.anahtar)).toEqual(['check', 'belirtilmemis']);
  });

  it('9 · O21: TRY dışı mağaza siparişi bu panele ULAŞMAZ (ayrım çağıranda)', () => {
    const x: PanoSiparisi[] = [
      sip({ id: 'r1', paymentMethod: 'cash', totalPrice: 6000 }),                               // Şirin İnşaat
      sip({ id: 'r2', paymentMethod: 'bank_transfer', totalPrice: 4000, customerName: 'Çelik Yapı A.Ş.' }),
      DOVIZLI,
    ];
    // (a) süzgeçsiz — yardımcı `dovizTutar`ı OKUMAZ: kayıt «tutarı bilinmeyen» düşer, 50 EUR TL'ye EKLENMEZ.
    const a = segmentCirosu(x, odemeYontemiSegmenti);
    expect(a.segmentler.find(s => s.anahtar === ODEME_YONTEMI_BELIRTILMEMIS)?.tutarsiz).toBe(1);
    expect(a.yuzdelerGecerli).toBe(false);
    expect(a.toplam).toBe(10000);
    // (b) çağıran reçetesiyle — sonuç sayısal, `tutarsiz` 0, `dovizli` 1.
    const { tl, dovizli } = cagiranReceti(x);
    const b = segmentCirosu(tl, odemeYontemiSegmenti);
    expect(b.segmentler.map(s => s.anahtar)).toEqual(['cash', 'bank_transfer']);
    expect(b.segmentler.map(s => Math.round(s.yuzde as number))).toEqual([60, 40]);
    expect(b.tutarsiz).toBe(0);
    expect(dovizli).toBe(1);
  });
});

/* ── 1b · segmentCirosu 4 parametreli biçim ───────────────────────────────── */

/**
 * Kalem — kanonik `OrderLineItem`ın ÇALIŞMA ANI hâli: Mikro türevi ve mağaza kaleminde `price` YOK (types.ts yorumu;
 * tutar `netTutar` / `total`dadır). Okuyucu TEK: `stokSevkiyat.kalemTutari`.
 */
type Kalem = Omit<OrderLineItem, 'price'> & { price?: number };
/** Kalemli sipariş fikstürü — `lineItems` çalışma anı kalemleri. */
type KalemliSiparis = Omit<PanoSiparisi, 'lineItems'> & { lineItems?: Kalem[] };

/** Stok kartları — kategori KARTTA durur (O22: kalemin `category`si hayalettir, yazıcısı yok). */
const KARTLAR = [
  { id: 'inv-boya', sku: 'BOYA-15', name: 'İÇ CEPHE BOYASI 15LT', category: 'Boya' },
  { id: 'inv-kimya', sku: 'KIM-25', name: 'SU YALITIM KİMYASALI 25KG', category: 'Yapı Kimyasalı' },
  { id: 'inv-cim', sku: 'CIM-50', name: 'ÇİMENTO 50KG', category: '   ' },        // kartta kategori GİRİLMEMİŞ
];
const kart = stokKartiCozucu(KARTLAR);
/** Bağlama reçetesinin (O22) test eşi: kartın DOLU kategorisi, yoksa `null` → anahtarsız. */
const kategori = (li: Kalem): string | null => {
  const k = kart(li)?.category;
  return typeof k === 'string' && k.trim() !== '' ? k.trim() : null;
};

const kalem = (o: Partial<Kalem> & Pick<Kalem, 'id' | 'sku' | 'name'>): Kalem => ({ quantity: 1, ...o });
const BOYA = (netTutar: number, id = 'k-boya'): Kalem => kalem({ id, sku: 'BOYA-15', name: 'İÇ CEPHE BOYASI 15LT', netTutar });
const KIMYA = (netTutar: number): Kalem => kalem({ id: 'k-kimya', sku: 'KIM-25', name: 'SU YALITIM KİMYASALI 25KG', netTutar });
const CIMENTO_KALEM = (price: number, quantity: number): Kalem =>
  kalem({ id: 'k-cim', sku: 'CIM-50', name: 'ÇİMENTO 50KG', price, quantity });

describe('segmentCirosu — 6c eki: 4 parametreli biçim (O10)', () => {
  // `segmentCirosu — SAYFA PARİTESİ` bloğunun fikstürünün AYNISI (o blokta yerel tanımlı).
  const siparisler: PanoSiparisi[] = [
    sip({ id: 's1', customerType: 'B2B', totalPrice: 60000 }),
    sip({ id: 's2', customerType: 'B2B', totalPrice: 40000 }),
    sip({ id: 's3', customerType: 'Dealer', totalPrice: 50000 }),
    sip({ id: 's4', customerType: 'Retail', totalPrice: 30000 }),
    sip({ id: 's5', customerType: undefined, totalPrice: 20000 }),
  ];

  it('1 · PARİTE: `{ tutarSec: siparisTutari }` ile sonuç 3 parametreli biçimle BİREBİR; `anahtarsiz` alanı YOK', () => {
    const eski = segmentCirosu(siparisler, b2bSegmenti, ['B2B', 'Diger']);
    const yeni = segmentCirosu(siparisler, b2bSegmenti, ['B2B', 'Diger'], { tutarSec: siparisTutari });
    expect(yeni).toEqual(eski);
    expect('anahtarsiz' in eski).toBe(false);
    expect('anahtarsiz' in yeni).toBe(false);
    const serbest = segmentCirosu(siparisler, donutSegmenti);
    expect(segmentCirosu(siparisler, donutSegmenti, undefined, { tutarSec: siparisTutari })).toEqual(serbest);
  });

  it('2 · KALEM dizisi cast\'siz geçer; `tutarSec` HEM genele HEM segmente uygulanır', () => {
    // Kanonik OrderLineItem[] de derlenir (3 parametreli biçimde TS2345 «no properties in common» verirdi).
    const kanonik = segmentCirosu([CIMENTO, DEMIR], k => k.name, undefined, { tutarSec: kalemTutari });
    expect(kanonik.toplam).toBe(500 * 10 + 1200 * 5);

    const kalemler: Kalem[] = [
      CIMENTO_KALEM(110, 100),                                                          // native: 110 × 100 = 11.000
      kalem({ id: 'k-mikro', sku: 'BOYA-15', name: 'İÇ CEPHE BOYASI 15LT', total: 5000 }), // Mikro kalemi: `price` yok
    ];
    const r = segmentCirosu(kalemler, k => k.name, undefined, { tutarSec: kalemTutari });
    expect(r.toplam).toBe(16000);
    expect(r.tamToplam).toBe(16000);
    expect(r.yuzdelerGecerli).toBe(true);
    expect(r.segmentler.map(s => [s.anahtar, s.ciro])).toEqual([['ÇİMENTO 50KG', 11000], ['İÇ CEPHE BOYASI 15LT', 5000]]);
    expect(r.segmentler.reduce((t, s) => t + (s.yuzde as number), 0)).toBeCloseTo(100, 9);
  });

  it('3 · anahtarsız kayıt uydurma segment OLMAZ ama paydada KALIR (K21 «Tüm ciro»)', () => {
    const kalemler: Kalem[] = [BOYA(6000), KIMYA(2000), CIMENTO_KALEM(20, 100)];       // çimento kartında kategori yok
    const r = segmentCirosu(kalemler, kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(r.segmentler.map(s => s.anahtar)).toEqual(['Boya', 'Yapı Kimyasalı']);
    expect(r.segmentler.map(s => Math.round(s.yuzde as number))).toEqual([60, 20]);
    expect(r.anahtarsiz).toEqual({ adet: 1, ciro: 2000, tutarsiz: 0 });
    expect(r.toplam).toBe(10000);
    expect(r.enBuyuk?.anahtar).toBe('Boya');
  });

  it('3b · kartı BULUNAMAYAN kalem de anahtarsız (boş anahtar eşleşmez; uydurma «Other» yok)', () => {
    const nakliye = kalem({ id: 'k-nak', sku: '', name: 'Nakliye bedeli', price: 750, quantity: 1 });
    const r = segmentCirosu([BOYA(6000), nakliye], kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(r.segmentler.map(s => s.anahtar)).toEqual(['Boya']);
    expect(r.anahtarsiz).toEqual({ adet: 1, ciro: 750, tutarsiz: 0 });
  });

  it('4 · MUTASYON-AYIRT EDİCİ: anahtarsızda tutarı bilinmeyen kayıt ₺0 SAYILMAZ, ÇİFT sayılmaz', () => {
    const tutarsiz = kalem({ id: 'k-x', sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 3 });   // fiyat / tutar YOK
    const r = segmentCirosu([BOYA(6000), tutarsiz], kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(r.anahtarsiz?.tutarsiz).toBe(1);
    expect(r.anahtarsiz?.adet).toBe(1);
    expect(Number.isNaN(r.anahtarsiz?.ciro)).toBe(true);    // hiç bilineni yok → ekran '—' (₺0 DEĞİL)
    expect(r.tutarsiz).toBe(1);                              // üst sayaç alt kümeyi ZATEN içerir — 2 DEĞİL
    expect(r.yuzdelerGecerli).toBe(false);
    expect(r.segmentler.every(s => s.yuzde === null)).toBe(true);
  });

  it('4b · MUTASYON-AYIRT EDİCİ: segmentli kaydın bilinmeyeni anahtarsız kümeye ATFEDİLMEZ (alt küme)', () => {
    // 6c inceleme 1: `anahtarsiz.tutarsiz` YALNIZ anahtarsız kümenin bilinmeyenidir (üst `tutarsiz`'ın alt kümesi). Kural
    // testsizdi: anahtarsız sayaca genel `tutarsiz` yazan mutasyon yeşil kalıyordu. Boya kartı bulunur (segmentli), tutarı YOK.
    const boyaTutarsiz = kalem({ id: 'k-boya-x', sku: 'BOYA-15', name: 'İÇ CEPHE BOYASI 15LT' });
    const r = segmentCirosu([boyaTutarsiz, CIMENTO_KALEM(20, 100)], kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(r.tutarsiz).toBe(1);
    expect(r.anahtarsiz).toEqual({ adet: 1, ciro: 2000, tutarsiz: 0 });
  });

  it('5 · bayraksız `null` anahtar → throw (sessiz «null» adlı segment UYDURULMAZ); bayrakla fırlatmaz', () => {
    const kalemler: Kalem[] = [BOYA(6000)];
    expect(() => segmentCirosu(kalemler, () => null, undefined, { tutarSec: kalemTutari })).toThrow(/anahtarsizSay/);
    expect(() => segmentCirosu(kalemler, () => null, undefined, { tutarSec: kalemTutari, anahtarsizSay: true })).not.toThrow();
    const ozel: SegmentCiroSecenek<Kalem> = { tutarSec: kalemTutari, anahtarsizSay: false };
    expect(() => segmentCirosu(kalemler, () => null, undefined, ozel)).toThrow();
  });

  it('6 · hepsi anahtarsız: segment yok, enBuyuk null, paydada yine TÜM ciro', () => {
    const kalemler: Kalem[] = [CIMENTO_KALEM(20, 100), CIMENTO_KALEM(30, 10)];
    const r = segmentCirosu(kalemler, kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(r.segmentler).toEqual([]);
    expect(r.enBuyuk).toBeNull();
    expect(r.anahtarsiz).toEqual({ adet: 2, ciro: 2300, tutarsiz: 0 });
    expect(r.toplam).toBe(2300);
  });

  it('6b · `anahtarlar` verilince anahtarsız sabit sıraya da beklenmedik satıra da GİRMEZ; boş liste', () => {
    const r = segmentCirosu([BOYA(6000), CIMENTO_KALEM(20, 100)], kategori, ['Yapı Kimyasalı', 'Boya'],
      { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(r.segmentler.map(s => [s.anahtar, s.ciro])).toEqual([['Yapı Kimyasalı', 0], ['Boya', 6000]]);
    expect(r.anahtarsiz?.adet).toBe(1);
    const bos = segmentCirosu([] as Kalem[], kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(bos).toMatchObject({ segmentler: [], toplam: 0, enBuyuk: null, anahtarsiz: { adet: 0, ciro: 0, tutarsiz: 0 } });
  });

  it('7 · DEĞİŞMEZ: Σ siparisSayisi + anahtarsiz.adet === n; donuk girdi mutasyona uğramaz', () => {
    const donuk = Object.freeze([BOYA(6000), KIMYA(2000), CIMENTO_KALEM(20, 100), BOYA(1000, 'k-boya-2')].map(k => Object.freeze(k)));
    const r = segmentCirosu(donuk, kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    const adet = r.segmentler.reduce((t, s) => t + s.siparisSayisi, 0);
    expect(adet + (r.anahtarsiz ? r.anahtarsiz.adet : 0)).toBe(donuk.length);
    expect(r.segmentler.map(s => [s.anahtar, s.siparisSayisi])).toEqual([['Boya', 2], ['Yapı Kimyasalı', 1]]);
  });

  it('8 · O21 — kalemde birim YOK, ayrım SİPARİŞTE (`flatMap`ten ÖNCE) yapılmalı (belge vakası)', () => {
    const tlSiparis: KalemliSiparis = {
      ...sip({ id: 'mf-1' }), totalPrice: 6000, lineItems: [BOYA(6000)],
    };
    const dovizliKalemli: KalemliSiparis = {
      ...DOVIZLI, lineItems: [kalem({ id: 'k-eur', sku: 'BOYA-15', name: 'İÇ CEPHE BOYASI 15LT', netTutar: 50, total: 59 })],
    };
    const x: KalemliSiparis[] = [tlSiparis, dovizliKalemli];
    // (a) süzgeçsiz — `kalemTutari` birimi BİLMEZ, EUR'yu TL sayar: ayrımın neden çağıranda ZORUNLU olduğunu kilitler.
    const a = segmentCirosu(x.flatMap(o => o.lineItems ?? []), kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(a.toplam).toBe(6050);
    // (b) çağıran reçetesiyle — `tryDisiMi` sipariş düzeyinde, `flatMap`ten önce.
    const { tl, dovizli } = cagiranReceti(x);
    const b = segmentCirosu(tl.flatMap(o => o.lineItems ?? []), kategori, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
    expect(b.toplam).toBe(6000);
    expect(dovizli).toBe(1);
  });
});
