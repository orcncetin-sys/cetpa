/**
 * tahsilatVade.test.ts — OrdersPage "Alacak Toplam" KPI'ı (Phase 522) + "Alacak Yaşlandırma
 * Raporu" (Phase 521) hesap sözleşmesi. ÖNCE YAZILDI (Faz 3 4/n, OrdersPage kapatma, 2026-09-19).
 *
 * Sahte kesinlik siteleri (src/pages/OrdersPage.tsx):
 *   543  `unpaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *   614  `b.items.reduce((s,o)=>s+(o.totalPrice||0),0)`
 * Tutarı bilinmeyen ödenmemiş sipariş ₺0 alacak sayılıyor, "Alacak Toplam" sessizce EKSİK
 * çıkıyor ve kart yeşile (`unpaidTotal > 0 ? kırmızı : yeşil`) dönüyordu. Kural (CLAUDE.md
 * "sahte kesinlik gösterme"): bilinmeyen tutar toplama GİRMEZ, SAYILIR.
 *
 * İkinci sınıf: 565'teki `zamanMs(o.createdAt ?? o.syncedAt) !== null` süzgeci tarihi
 * çözülemeyen ödenmemiş siparişi yaşlandırmadan komple düşürüyordu — ne kovada ne de
 * ekranda; yalnız KPI sayacında görünüyordu. Burada AYRI sayılır (`tarihsiz`).
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari } from '../para';
import { paraYaz } from '../currency';
import { odenmemisOzeti, odenmemisSiparisler, kovaTutari, type VadeSiparisi } from './tahsilatVade';

// 19 Eylül 2026, yerel. Gün aritmetiği `new Date(y, m, d - n)` ile — DST/UTC kayması yok.
const BUGUN = new Date(2026, 8, 19);
const gunOnce = (n: number): Date => new Date(2026, 8, 19 - n);

const sip = (p: Partial<VadeSiparisi> & { gun?: number } = {}): VadeSiparisi => {
  const { gun, ...rest } = p;
  return {
    totalPrice: 1000,
    paid: false,
    status: 'Confirmed',
    ...(gun === undefined ? {} : { createdAt: gunOnce(gun) }),
    ...rest,
  };
};

// Türkçe fikstür: Şirin İnşaat'ın ÇİMENTO 50KG siparişleri.
const SIRIN: readonly VadeSiparisi[] = [
  sip({ gun: 5, totalPrice: 12_500 }),    // 0–30
  sip({ gun: 29, totalPrice: 7_250.5 }),  // 0–30
  sip({ gun: 45, totalPrice: 40_000 }),   // 31–60
  sip({ gun: 75, totalPrice: 3_000 }),    // 61–90
  sip({ gun: 400, totalPrice: 1_250 }),   // 90+
  sip({ gun: 10, totalPrice: 9_999, paid: true }),        // ödenmiş → aday değil
  sip({ gun: 10, totalPrice: 8_888, status: 'Cancelled' }), // iptal → aday değil
];

describe('odenmemisSiparisler — hangi sipariş "alacak" sayılır', () => {
  it('ödenmemiş + iptal değil + ödemesi Cetpa\'da izlenen → aday (sayfa 542 süzgeciyle birebir)', () => {
    expect(odenmemisSiparisler(SIRIN)).toHaveLength(5);
  });

  it('MUTASYON-AYIRT EDİCİ: Mikro kaynaklı kayıt aday DEĞİL — `paid` yokluğu "ödenmedi" değil BİLİNMİYOR', () => {
    const mikro: VadeSiparisi[] = [
      sip({ gun: 10, source: 'mikro-fatura', paid: undefined, totalPrice: 1_000_000 }),
      sip({ gun: 10, source: 'mikro-siparis', paid: undefined, totalPrice: 500_000 }),
    ];
    expect(odenmemisSiparisler(mikro)).toHaveLength(0);
    // ₺1,5M'lik sahte alacak KPI'a girmez:
    expect(ekranTutari(odenmemisOzeti(mikro, BUGUN).toplam)).toBe(0);
  });

  it('faturalı sipariş yaşlandırmadan DÜŞMEZ (sayfa 542/565 davranışı: faturaliHaric yok)', () => {
    expect(odenmemisSiparisler([sip({ gun: 10, faturali: true })])).toHaveLength(1);
  });
});

describe('SAYFA PARİTESİ — bilinen girdide sayı eskiyle birebir', () => {
  it('KPI "Alacak Toplam" (543) = ödenmemişlerin totalPrice toplamı', () => {
    const ozet = odenmemisOzeti(SIRIN, BUGUN);
    const eski = odenmemisSiparisler(SIRIN).reduce((s, o) => s + ((o.totalPrice as number) || 0), 0);
    expect(eski).toBe(64_000.5);
    expect(ekranTutari(ozet.toplam)).toBe(64_000.5);
    expect(ozet.adet).toBe(5);
  });

  it('kova adetleri + kova tutarları (614) eskiyle aynı; kart sırası 0–30 / 31–60 / 61–90 / 90+', () => {
    const { kovalar } = odenmemisOzeti(SIRIN, BUGUN);
    expect(kovalar.map(k => k.ad)).toEqual(['b0_30', 'b31_60', 'b61_90', 'b90p']);
    expect(kovalar.map(k => k.etiket)).toEqual(['0–30', '31–60', '61–90', '90+']);
    expect(kovalar.map(k => k.etiketTR)).toEqual(['0–30 gün', '31–60 gün', '61–90 gün', '90+ gün']);
    expect(kovalar.map(k => k.adet)).toEqual([2, 1, 1, 1]);
    expect(kovalar.map(k => kovaTutari(k))).toEqual([19_750.5, 40_000, 3_000, 1_250]);
  });

  it('`eskiVar` = 31+ kovalarında kayıt var mı (sayfa `hasOld`)', () => {
    expect(odenmemisOzeti(SIRIN, BUGUN).eskiVar).toBe(true);
    expect(odenmemisOzeti([sip({ gun: 3 }), sip({ gun: 30 })], BUGUN).eskiVar).toBe(false);
  });

  it('hiç aday yoksa toplam gerçek 0 (boş liste sahte değil, gerçekten sıfır)', () => {
    const bos = odenmemisOzeti([], BUGUN);
    expect(ekranTutari(bos.toplam)).toBe(0);
    expect(bos.adet).toBe(0);
    expect(bos.kovalar.every(k => k.adet === 0)).toBe(true);
    expect(bos.tarihsiz).toBe(0);
  });
});

describe('MUTASYON-AYIRT EDİCİ — bilinmeyen tutar 0 sayılmaz', () => {
  const karisik: VadeSiparisi[] = [
    sip({ gun: 5, totalPrice: 10_000 }),
    sip({ gun: 5, totalPrice: null }),        // alan hiç gelmemiş
    sip({ gun: 5, totalPrice: '' }),          // boş string (`Number('') === 0` tuzağı)
    sip({ gun: 5, totalPrice: 'ÇİMENTO' }),   // sayısal olmayan
    sip({ gun: 5, totalPrice: NaN }),
  ];

  it('KPI toplamı KISMİ kalır ve bilinmeyenler SAYILIR (eski `|| 0` 10.000 basıp "tam" diyordu)', () => {
    const { toplam } = odenmemisOzeti(karisik, BUGUN);
    expect(toplam.toplam).toBe(10_000);
    expect(toplam.bilinen).toBe(1);
    expect(toplam.bilinmeyen).toBe(4);      // ← `|| 0`'a dönerse bu 0 olur, test kırılır
    expect(ekranTutari(toplam)).toBe(10_000); // kısmi toplam + sayfa "4 kayıt tutarsız" notu
  });

  it('HİÇ bilinen yokken ekran NaN → paraYaz "—" (₺0 BASILMAZ, kart yeşile dönmez)', () => {
    const hicbiri = [sip({ gun: 5, totalPrice: null }), sip({ gun: 40, totalPrice: undefined })];
    const ozet = odenmemisOzeti(hicbiri, BUGUN);
    expect(Number.isFinite(ekranTutari(ozet.toplam))).toBe(false);
    expect(paraYaz(ekranTutari(ozet.toplam), { ondalik: 0 })).toBe('—');
    // adet gerçek: 2 ödenmemiş sipariş VAR, tutarı bilinmiyor.
    expect(ozet.adet).toBe(2);
    // `unpaidTotal > 0 ? kırmızı : yeşil` kapısı: NaN yeşil DEĞİL, bilinmiyor.
    expect(ekranTutari(ozet.toplam) > 0).toBe(false);
  });

  it('kova tutarı da aynı sözleşme: tutarı bilinmeyen sipariş kovada SAYILIR, tutarı "—"', () => {
    const { kovalar } = odenmemisOzeti([sip({ gun: 100, totalPrice: null })], BUGUN);
    const k90 = kovalar[3];
    expect(k90.adet).toBe(1);                  // kart üstündeki büyük sayı: 1 kayıt
    expect(k90.tutar.bilinmeyen).toBe(1);
    expect(Number.isFinite(kovaTutari(k90))).toBe(false);
    expect(paraYaz(kovaTutari(k90), { ondalik: 0 })).toBe('—');
  });

  it('MEŞRU 0 tutar bilinmiyor DEĞİL — bilinen 0 olarak sayılır', () => {
    const { toplam } = odenmemisOzeti([sip({ gun: 5, totalPrice: 0 })], BUGUN);
    expect(toplam.bilinen).toBe(1);
    expect(toplam.bilinmeyen).toBe(0);
    expect(ekranTutari(toplam)).toBe(0);
  });

  it('totalPrice yoksa totalAmount okunur (siparis.ts `siparisTutari` tek kaynağı)', () => {
    const { toplam } = odenmemisOzeti([sip({ gun: 5, totalPrice: undefined, totalAmount: 5_000 })], BUGUN);
    expect(ekranTutari(toplam)).toBe(5_000);
    expect(toplam.bilinmeyen).toBe(0);
  });

  it('sayısal string kabul (Mikro aynası tutarı string yazıyor)', () => {
    const { toplam } = odenmemisOzeti([sip({ gun: 5, totalPrice: '1250.75' })], BUGUN);
    expect(ekranTutari(toplam)).toBe(1250.75);
  });
});

describe('MUTASYON-AYIRT EDİCİ — vade tarihi okunamayan sipariş', () => {
  const tarihsizler: VadeSiparisi[] = [
    sip({ gun: 5, totalPrice: 2_000 }),
    { totalPrice: 30_000, paid: false, status: 'Confirmed' },                      // hiç tarih alanı yok
    { totalPrice: 7_000, paid: false, status: 'Confirmed', createdAt: 'yakında' }, // çözülemeyen tarih
  ];

  it('AYRI sayılır: hiçbir kovaya düşmez, "bugün"e de düşmez', () => {
    const ozet = odenmemisOzeti(tarihsizler, BUGUN);
    expect(ozet.tarihsiz).toBe(2);
    expect(ozet.yaslandirilanAdet).toBe(1);
    expect(ozet.kovalar.reduce((s, k) => s + k.adet, 0)).toBe(1); // ← 0-30 kovasına düşerse 3 olur
    expect(kovaTutari(ozet.kovalar[0])).toBe(2_000);              // ← 39.000 olursa yanlış kova
  });

  it('KPI toplamı tarihsizleri YİNE DE içerir (alacak gerçek, yalnız yaşı bilinmiyor)', () => {
    const ozet = odenmemisOzeti(tarihsizler, BUGUN);
    expect(ekranTutari(ozet.toplam)).toBe(39_000);
    expect(ozet.adet).toBe(3);
  });

  it('adet = yaslandirilanAdet + tarihsiz (değişmez)', () => {
    for (const liste of [SIRIN, tarihsizler, [] as VadeSiparisi[]]) {
      const o = odenmemisOzeti(liste, BUGUN);
      expect(o.yaslandirilanAdet + o.tarihsiz).toBe(o.adet);
    }
  });
});

describe('kova sınırları — yerel gün (zaman.ts gunFarki), ham ms bölmesi değil', () => {
  it('30. gün 0–30, 31. gün 31–60, 60/61, 90/91 sınırları', () => {
    const k = (gun: number) => odenmemisOzeti([sip({ gun })], BUGUN).kovalar.find(x => x.adet === 1)!.ad;
    expect(k(0)).toBe('b0_30');
    expect(k(30)).toBe('b0_30');
    expect(k(31)).toBe('b31_60');
    expect(k(60)).toBe('b31_60');
    expect(k(61)).toBe('b61_90');
    expect(k(90)).toBe('b61_90');
    expect(k(91)).toBe('b90p');
  });

  it('gelecek tarihli sipariş 0–30 kovasında (negatif yaş 90+ olmaz)', () => {
    const ozet = odenmemisOzeti([{ totalPrice: 500, paid: false, status: 'Confirmed', createdAt: new Date(2026, 8, 25) }], BUGUN);
    expect(ozet.kovalar[0].adet).toBe(1);
    expect(ozet.tarihsiz).toBe(0);
  });

  it('MUTASYON-AYIRT EDİCİ: saat farkı gün sınırını kaydırmaz — dün 23:00 bugün 01:00\'de 1 gündür', () => {
    // Ham `Math.floor((now - ms)/86400000)` bunu 0 gün sayardı; yerel gün farkı 1 der.
    const dun2300 = new Date(2026, 8, 18, 23, 0);
    const bugun0100 = new Date(2026, 8, 19, 1, 0);
    const ozet = odenmemisOzeti([{ totalPrice: 100, paid: false, status: 'Confirmed', createdAt: dun2300 }], bugun0100);
    expect(ozet.kovalar[0].adet).toBe(1);
    expect(ozet.tarihsiz).toBe(0);
  });

  it('createdAt çözülemezse syncedAt okunur (sayfa `createdAt ?? syncedAt` bunu kaçırıyordu)', () => {
    const ozet = odenmemisOzeti(
      [{ totalPrice: 300, paid: false, status: 'Confirmed', createdAt: 'bozuk', syncedAt: gunOnce(45) }],
      BUGUN,
    );
    expect(ozet.tarihsiz).toBe(0);
    expect(ozet.kovalar[1].adet).toBe(1); // 31–60
  });
});
