/**
 * finansKpi.test.ts — Pano (DashboardPage) finansal KPI / uyarı şeritlerinin SÖZLEŞMESİ.
 * Faz 3 5/n, grup "finansKpi", 2026-09-19. ÖNCE YAZILDI (kırmızı görüldü).
 *
 * NEDEN VAR — DashboardPage'de aynı arıza beş panelde tekrarlıyordu: BİLİNMEYEN bir sayı
 * sessizce 0 sayılıp ekrana KESİN bir rakam/uyarı olarak basılıyordu:
 *   · 284  `inventory.filter(i => (i.stockLevel ?? 0) <= 0)` → stok seviyesi OKUNAMAYAN ürün
 *          "stokta kalmadı" uyarısı üretiyordu (kırmızı alarm, gerçekte veri yok).
 *   · 615  `(Number(i.stock) || 0) > 0 && … <= (Number(i.minStock) || 5)` → `stock` diye bir
 *          alan InventoryItem'da YOK (kanonik ad `stockLevel`), üstelik `|| 5` eşiği uyduruyor.
 *   · 620  `${top.stock ?? 0} adet kaldı` → bilinmeyen adet "0 adet" diye yazılıyordu.
 *   · 674  `unpaidOrders.reduce((s,o) => s + (o.totalPrice ?? 0), 0)` → tutarsız sipariş ₺0.
 *   · 688-696 bu/geçen ay ciro `?? 0` toplanıp aralarındaki YÜZDE kesin gibi basılıyordu.
 *   · 939  AOV: `sum(totalPrice || 0) / filteredOrders.length` → tutarı okunamayan sipariş
 *          PAYDAYA giriyor ama PAYA 0 katıyor; ortalama sistematik olarak aşağı çekiliyordu.
 *          Üstelik hiç sipariş yokken AOV "₺0" (oysa "veri yok").
 *   · 949  teslimat/dönüşüm oranı: liste boşken `0` → ekranda "%0 teslimat" sahte kesinliği.
 *   · 1024 `(i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)` → aynı sahte sıfır
 *          + uydurma eşik, bu kez KRİTİK STOK UYARISI olarak.
 *   · 1071-1073 günlük nakit: ciro/tahsilat/alacak `(o.totalPrice || 0)` ile toplanıyordu.
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme" + para.ts iki sözleşme):
 *   EKRAN toplamı kısmi olabilir (ekranTutari + "N kayıt tutarsız" notu);
 *   TÜRETİLEN sayı (ortalama/oran/yüzde) bir girdi bile bilinmiyorsa ÜRETİLMEZ ('—').
 *   Değeri BİLİNMEYEN bir KPI için uyarı üretilmez — "veri yok" diye listelenir.
 */
import { describe, it, expect } from 'vitest';
import {
  stokDurumu,
  odenmemisSiparisler,
  gecikmisOdemeler,
  bekleyenSiparisler,
  aktifAdayMi,
  gecikmisAdaylar,
  aylikCiroDegisimi,
  ortalamaSiparisTutari,
  teslimatOrani,
  adayDonusumOrani,
  huniKazanmaOrani,
  tekrarEdenAlicilar,
  nakitPozisyonu,
  finansKpilari,
  esikUyarilari,
  type KpiSiparis,
  type KpiStokKalemi,
} from './finansKpi';

// ── Türkçe fikstürler ────────────────────────────────────────────────────────
const GUN = 86_400_000;
const SIMDI = new Date('2026-09-19T10:00:00+03:00').getTime();
const gunOnce = (n: number) => new Date(SIMDI - n * GUN).toISOString();

/** Sipariş fikstürü — alanları bilerek `unknown`: gerçek kayıtlarda eksik gelebiliyor. */
const sip = (o: Partial<KpiSiparis> = {}): KpiSiparis => ({
  customerName: 'Şirin İnşaat', status: 'Pending', ...o,
});

/** Ürün fikstürü — `name` içgörü metninde geçtiği için kalemle birlikte taşınır. */
const urun = (o: Partial<KpiStokKalemi> & { name?: string } = {}): KpiStokKalemi & { name: string } => ({
  name: 'ÇİMENTO 50KG', ...o,
});

describe('stokDurumu — stok seviyesi BİLİNMİYORSA "stokta kalmadı" denmez', () => {
  it('SAYFA PARİTESİ: seviyeler biliniyorken tükenen/kritik sayıları eskiyle birebir', () => {
    const envanter = [
      urun({ name: 'ÇİMENTO 50KG', stockLevel: 0, lowStockThreshold: 10 }),   // tükendi
      urun({ name: 'DEMİR Ø12', stockLevel: 4, lowStockThreshold: 10 }),      // kritik
      urun({ name: 'TUĞLA', stockLevel: 800, lowStockThreshold: 100 }),       // normal
    ];
    const d = stokDurumu(envanter);
    expect(d.tukenen.length).toBe(1);
    expect(d.kritik.length).toBe(1);
    expect(d.esikAltinda.length).toBe(2);        // Phase 124 sayacı: tükenen + kritik
    expect(d.enDusukKritik?.name).toBe('DEMİR Ø12');
    expect(d.seviyesiBilinmeyen).toBe(0);
    expect(d.esigiBilinmeyen).toBe(0);
  });

  it('MUTASYON AYIRT EDİCİ: seviyesi okunamayan ürün "tükendi" SAYILMAZ, ayrı sayılır', () => {
    // `(i.stockLevel ?? 0) <= 0` kapısı geri konursa bu ürün kırmızı "stokta kalmadı" uyarısı üretir.
    const envanter = [
      urun({ name: 'ÇİMENTO 50KG', stockLevel: null, lowStockThreshold: 10 }),
      urun({ name: 'DEMİR Ø12', stockLevel: undefined, lowStockThreshold: 10 }),
      urun({ name: 'TUĞLA', stockLevel: 'okunamadı', lowStockThreshold: 10 }),
    ];
    const d = stokDurumu(envanter);
    expect(d.tukenen.length).toBe(0);
    expect(d.esikAltinda.length).toBe(0);
    expect(d.seviyesiBilinmeyen).toBe(3);
  });

  it('MUTASYON AYIRT EDİCİ: eşiği bilinmeyen ürüne uydurma 5 eşiği uygulanmaz', () => {
    // Eski `(… ?? i.minStock ?? 5)`: eşiksiz bir üründe stok 3 iken "kritik stok" alarmı çalıyordu.
    const d = stokDurumu([urun({ stockLevel: 3, lowStockThreshold: undefined, minStock: undefined })]);
    expect(d.kritik.length).toBe(0);
    expect(d.esikAltinda.length).toBe(0);
    expect(d.esigiBilinmeyen).toBe(1);
    // Ama gerçekten 0'a düşmüşse eşik bilinmese de tükendiği KESİNDİR:
    const d2 = stokDurumu([urun({ stockLevel: 0 })]);
    expect(d2.tukenen.length).toBe(1);
  });

  it('eşik `minStock` alanından da okunur (lowStockThreshold yoksa) — eski öncelik korunur', () => {
    const d = stokDurumu([urun({ stockLevel: 4, minStock: 10 })]);
    expect(d.kritik.length).toBe(1);
    expect(d.esigiBilinmeyen).toBe(0);
  });

  it('meşru 0 eşik uydurma 5 ile ezilmez (0 ≤ 0 → tükenen)', () => {
    const d = stokDurumu([urun({ stockLevel: 0, lowStockThreshold: 0 })]);
    expect(d.esikAltinda.length).toBe(1);
    expect(d.esigiBilinmeyen).toBe(0);
  });

  it('en düşük kritik ürün seçilirken girdi dizisi MUTASYONA uğramaz', () => {
    const envanter = [
      urun({ name: 'TUĞLA', stockLevel: 9, lowStockThreshold: 10 }),
      urun({ name: 'DEMİR Ø12', stockLevel: 2, lowStockThreshold: 10 }),
    ];
    const kopya = [...envanter];
    const d = stokDurumu(envanter);
    expect(d.enDusukKritik?.name).toBe('DEMİR Ø12');
    expect(envanter).toEqual(kopya);
  });
});

describe('odenmemisSiparisler — bekleyen tahsilat KISMİ toplamdır, 0 değil', () => {
  it('SAYFA PARİTESİ: tutarların hepsi biliniyorsa toplam eskiyle birebir', () => {
    const s = odenmemisSiparisler([
      sip({ totalPrice: 12_500, paid: false }),
      sip({ totalPrice: 7_500, paid: false }),
      sip({ totalPrice: 1_000, paid: true }),
      sip({ totalPrice: 9_999, paid: false, status: 'Cancelled' }),
    ]);
    expect(s.sayi).toBe(2);
    expect(s.tutar.toplam).toBe(20_000);
    expect(s.ekran).toBe(20_000);
    expect(s.tutar.bilinmeyen).toBe(0);
  });

  it('MUTASYON AYIRT EDİCİ: tutarı okunamayan sipariş ₺0 sayılmaz, SAYILIR', () => {
    // `+ (o.totalPrice ?? 0)` geri konursa toplam yine 20.000 çıkar ama "2 kayıt tutarsız" kaybolur.
    const s = odenmemisSiparisler([
      sip({ totalPrice: 20_000, paid: false }),
      sip({ totalPrice: null, paid: false }),
      sip({ totalPrice: undefined, paid: false }),
    ]);
    expect(s.sayi).toBe(3);
    expect(s.tutar.toplam).toBe(20_000);
    expect(s.tutar.bilinmeyen).toBe(2);
  });

  it('hiçbir tutar bilinmiyorsa EKRAN değeri NaN — fmtKpi "—" basar, "₺0" değil', () => {
    const s = odenmemisSiparisler([sip({ totalPrice: null, paid: false })]);
    expect(Number.isNaN(s.ekran)).toBe(true);
  });

  it('Mikro kaynaklı siparişin `paid` alanına bakılmaz (tahsilat Mikro cari hesapta)', () => {
    const s = odenmemisSiparisler([
      sip({ totalPrice: 5_000, paid: false, source: 'mikro-siparis' }),
      sip({ totalPrice: 5_000, paid: false, source: 'mikro-fatura' }),
    ]);
    expect(s.sayi).toBe(0);
  });

  it('durum süzgeciyle "teslim edilmiş ama ödenmemiş" (Phase 528) sayılır', () => {
    const s = odenmemisSiparisler([
      sip({ totalPrice: 5_000, paid: false, status: 'Delivered' }),
      sip({ totalPrice: 5_000, paid: false, status: 'Pending' }),
    ], { durum: 'Delivered' });
    expect(s.sayi).toBe(1);
  });
});

describe('gecikmiş kayıtlar — TARİHİ okunamayan kayıt "gecikmiş" ilan edilmez', () => {
  it('SAYFA PARİTESİ: 30+ gündür ödenmemiş sipariş sayısı eskiyle birebir', () => {
    const g = gecikmisOdemeler([
      sip({ totalPrice: 1_000, paid: false, createdAt: gunOnce(45) }),
      sip({ totalPrice: 1_000, paid: false, createdAt: gunOnce(10) }),
      sip({ totalPrice: 1_000, paid: true, createdAt: gunOnce(45) }),
    ], { simdi: SIMDI, gun: 30 });
    expect(g.sayi).toBe(1);
    expect(g.tarihsiz).toBe(0);
  });

  it('MUTASYON AYIRT EDİCİ: tarihi olmayan ödenmemiş sipariş gecikmiş SAYILMAZ, ayrı sayılır', () => {
    const g = gecikmisOdemeler([
      sip({ totalPrice: 1_000, paid: false, createdAt: null }),
      sip({ totalPrice: 1_000, paid: false, createdAt: 'çözülemez' }),
    ], { simdi: SIMDI, gun: 30 });
    expect(g.sayi).toBe(0);
    expect(g.tarihsiz).toBe(2);
  });

  it('bekleyen sipariş şeridi (Phase 528): 3+ gündür Pending olanlar, tarihsizler ayrı', () => {
    const b = bekleyenSiparisler([
      sip({ status: 'Pending', createdAt: gunOnce(5) }),
      sip({ status: 'Pending', createdAt: gunOnce(1) }),
      sip({ status: 'Pending', createdAt: undefined, syncedAt: undefined }),
      sip({ status: 'Delivered', createdAt: gunOnce(5) }),
    ], { simdi: SIMDI, gun: 3 });
    expect(b.sayi).toBe(1);
    expect(b.tarihsiz).toBe(1);
  });

  it('bekleyen sipariş tarihi `createdAt` yoksa `syncedAt`ten okunur (Mikro siparişleri)', () => {
    const b = bekleyenSiparisler(
      [sip({ status: 'Pending', createdAt: undefined, syncedAt: gunOnce(9) })],
      { simdi: SIMDI, gun: 3 },
    );
    expect(b.sayi).toBe(1);
    expect(b.tarihsiz).toBe(0);
  });
});

describe('aktifAdayMi / gecikmisAdaylar', () => {
  it('kapanmış aday AKTİF sayılmaz — "Closed Won"/"Closed Lost" dahil', () => {
    expect(aktifAdayMi({ status: 'Qualified' })).toBe(true);
    expect(aktifAdayMi({ status: 'Closed' })).toBe(false);
    expect(aktifAdayMi({ status: 'Closed Won' })).toBe(false);
    expect(aktifAdayMi({ status: 'Closed Lost' })).toBe(false);
  });

  it('SAYFA PARİTESİ: 7+ gündür güncellenmemiş aktif aday sayısı', () => {
    const g = gecikmisAdaylar([
      { status: 'Contacted', updatedAt: gunOnce(10) },
      { status: 'Contacted', updatedAt: gunOnce(2) },
      { status: 'Closed Won', updatedAt: gunOnce(30) },
    ], { simdi: SIMDI, gun: 7 });
    expect(g.sayi).toBe(1);
  });

  it('MUTASYON AYIRT EDİCİ: tarihsiz aday "7+ gündür güncellenmedi" DEMEZ, ayrı sayılır', () => {
    // Phase 90 (680) `if (!raw) return true` diyordu: hiç tarihi olmayan aday kesin gecikmiş
    // gibi raporlanıyordu. Phase 528 ise aynı adayı hiç saymıyordu — aynı sayfada iki cevap.
    const g = gecikmisAdaylar([
      { status: 'New', updatedAt: undefined, createdAt: undefined },
      { status: 'New', updatedAt: null, createdAt: null },
    ], { simdi: SIMDI, gun: 7 });
    expect(g.sayi).toBe(0);
    expect(g.tarihsiz).toBe(2);
  });

  it('updatedAt yoksa createdAt kullanılır', () => {
    const g = gecikmisAdaylar([{ status: 'New', createdAt: gunOnce(20) }], { simdi: SIMDI, gun: 7 });
    expect(g.sayi).toBe(1);
    expect(g.tarihsiz).toBe(0);
  });
});

describe('aylikCiroDegisimi — kısmi aydan yüzde TÜRETİLMEZ', () => {
  const buAy = '2026-09-10T09:00:00+03:00';
  const gecenAy = '2026-08-10T09:00:00+03:00';

  it('SAYFA PARİTESİ: tutarlar biliniyorken yüzde eskiyle birebir (%50 artış)', () => {
    const d = aylikCiroDegisimi([
      sip({ totalPrice: 150_000, createdAt: buAy }),
      sip({ totalPrice: 100_000, createdAt: gecenAy }),
    ], SIMDI);
    expect(d.yuzde).toBe(50);
    expect(d.yon).toBe('artis');
    expect(d.belirginArtis).toBe(true);
  });

  it('MUTASYON AYIRT EDİCİ: aylardan birinde tek kayıt okunamadıysa yüzde ÜRETİLMEZ', () => {
    // `?? 0` geri konursa bu vaka yine "%50 artış" der — oysa eksik kayıt artışı da düşüşü de yapabilir.
    const d = aylikCiroDegisimi([
      sip({ totalPrice: 150_000, createdAt: buAy }),
      sip({ totalPrice: null, createdAt: buAy }),
      sip({ totalPrice: 100_000, createdAt: gecenAy }),
    ], SIMDI);
    expect(d.yuzde).toBeNull();
    expect(d.belirginArtis).toBe(false);
    expect(d.buAy.bilinmeyen).toBe(1);
  });

  it('geçen ay hiç ciro yoksa yüzde yok (sıfırdan artış sonsuzdur)', () => {
    const d = aylikCiroDegisimi([sip({ totalPrice: 150_000, createdAt: buAy })], SIMDI);
    expect(d.yuzde).toBeNull();
    expect(d.belirginArtis).toBe(false);
  });

  it('%10 eşiğinin altındaki artış "belirgin" sayılmaz (eski 1.1 katsayısı)', () => {
    const d = aylikCiroDegisimi([
      sip({ totalPrice: 105_000, createdAt: buAy }),
      sip({ totalPrice: 100_000, createdAt: gecenAy }),
    ], SIMDI);
    expect(d.yuzde).toBe(5);
    expect(d.belirginArtis).toBe(false);
  });

  it('tarihi çözülemeyen sipariş hiçbir aya yazılmaz', () => {
    const d = aylikCiroDegisimi([sip({ totalPrice: 150_000, createdAt: 'çözülemez' })], SIMDI);
    expect(d.buAy.bilinen).toBe(0);
    expect(d.buAy.bilinmeyen).toBe(0);
  });
});

describe('ortalamaSiparisTutari (AOV) — TÜRETME: bilinmeyen tutar PAYDAYA girmez', () => {
  it('SAYFA PARİTESİ: tutarların hepsi biliniyorsa AOV eskiyle birebir', () => {
    const a = ortalamaSiparisTutari([
      sip({ totalPrice: 30_000 }),
      sip({ totalPrice: 10_000 }),
    ]);
    expect(a.deger).toBe(20_000);
    expect(a.sayilan).toBe(2);
    expect(a.bilinmeyen).toBe(0);
  });

  it('MUTASYON AYIRT EDİCİ: tutarsız sipariş ortalamayı AŞAĞI ÇEKMEZ', () => {
    // Eski: (30.000 + 0) / 2 = 15.000 — gerçekte bilinen tek sipariş 30.000'di.
    const a = ortalamaSiparisTutari([
      sip({ totalPrice: 30_000 }),
      sip({ totalPrice: null }),
    ]);
    expect(a.deger).toBe(30_000);
    expect(a.sayilan).toBe(1);
    expect(a.bilinmeyen).toBe(1);
  });

  it('MUTASYON AYIRT EDİCİ: hiç sipariş yokken AOV "₺0" değil, BİLİNMİYOR (NaN → "—")', () => {
    expect(Number.isNaN(ortalamaSiparisTutari([]).deger)).toBe(true);
    expect(Number.isNaN(ortalamaSiparisTutari([sip({ totalPrice: undefined })]).deger)).toBe(true);
  });

  it('tutar `totalAmount` alanından da okunur (siparisTutari tek kaynak)', () => {
    const a = ortalamaSiparisTutari([sip({ totalPrice: undefined, totalAmount: 8_000 })]);
    expect(a.deger).toBe(8_000);
  });
});

describe('teslimatOrani / adayDonusumOrani — boş listede "%0" yok', () => {
  it('SAYFA PARİTESİ: teslimat oranı eskiyle birebir (yuvarlanmış yüzde)', () => {
    const t = teslimatOrani([
      sip({ status: 'Delivered' }), sip({ status: 'Delivered' }),
      sip({ status: 'Delivered' }), sip({ status: 'Pending' }),
    ]);
    expect(t.oran).toBe(75);
    expect(t.teslim).toBe(3);
    expect(t.toplam).toBe(4);
  });

  it('MUTASYON AYIRT EDİCİ: sipariş yokken oran null — "%0 teslimat" basılmaz', () => {
    expect(teslimatOrani([]).oran).toBeNull();
  });

  it('MUTASYON AYIRT EDİCİ: durumu okunamayan sipariş paydaya girmez, SAYILIR', () => {
    const t = teslimatOrani([sip({ status: 'Delivered' }), sip({ status: undefined })]);
    expect(t.oran).toBe(100);
    expect(t.toplam).toBe(1);
    expect(t.durumsuz).toBe(1);
  });

  it('SAYFA PARİTESİ: aday dönüşümü "Closed" ve "Closed Won"u kazanılmış sayar, "Closed Lost"u saymaz', () => {
    const d = adayDonusumOrani([
      { status: 'Closed Won' }, { status: 'Closed' },
      { status: 'Closed Lost' }, { status: 'Qualified' },
    ]);
    expect(d.kazanilan).toBe(2);
    expect(d.toplam).toBe(4);
    expect(d.oran).toBe(50);
  });

  it('MUTASYON AYIRT EDİCİ: aday yokken dönüşüm oranı null', () => {
    expect(adayDonusumOrani([]).oran).toBeNull();
  });
});

/**
 * Aday HUNİSİ'nin kazanma oranı (DashboardPage "Lead Pipeline Funnel" rozeti). KPI kartının
 * `adayDonusumOrani`ndan FARKLI bir tanımdır (huni yalnız aktif aşamalar + 'Closed Won'a bakar;
 * 'Closed' ve 'Closed Lost' hunide hiç görünmez) — tanım farkı Açık İşler'e yazıldı.
 *
 * Sayfadaki hâli `totalActive > 0 ? … : '0'` idi: kapı YANLIŞ paydaya (`totalActive`) bakıyor,
 * oran ise `totalActive + counts[5]`e bölüyordu. Hepsi kapanmış bir huni ('Closed Won' 4, aktif 0)
 * gerçekte %100'ken ekrana "Win Rate: 0%" basıyordu; hiç aday yokken de '—' yerine '0%'.
 * Kapanış ölçüsünün `\|\||\?\?` regex'i bu `: '0'` üçlü-yedeğini görmüyordu.
 */
describe('huniKazanmaOrani — huni rozeti, payda AKTİF + KAZANILAN', () => {
  it('SAYFA PARİTESİ: aktif aşamalar varken oran eskiyle birebir', () => {
    // New 10, Contacted 6, Qualified 4, Proposal 2, Negotiation 2 → aktif 24; Closed Won 6.
    expect(huniKazanmaOrani([10, 6, 4, 2, 2], 6)).toBe(20);   // 6 / 30
  });

  it('MUTASYON AYIRT EDİCİ: hepsi kapanmışken (aktif 0, kazanılan 4) oran %100 — "%0" DEĞİL', () => {
    expect(huniKazanmaOrani([0, 0, 0, 0, 0], 4)).toBe(100);
  });

  it('MUTASYON AYIRT EDİCİ: hiç aday yokken null ("%0" sahte kesinliktir, rozet çizilmez)', () => {
    expect(huniKazanmaOrani([0, 0, 0, 0, 0], 0)).toBeNull();
    expect(huniKazanmaOrani([], 0)).toBeNull();
  });

  it('hiç kazanılmamış ama aktif adaylar varken gerçek %0', () => {
    expect(huniKazanmaOrani([5, 3], 0)).toBe(0);
  });
});

describe('tekrarEdenAlicilar — adı bilinmeyen siparişler TEK müşteriye yığılmaz', () => {
  it('SAYFA PARİTESİ: adlar biliniyorken tekrar eden alıcı sayısı eskiyle birebir', () => {
    const r = tekrarEdenAlicilar([
      sip({ customerName: 'Şirin İnşaat' }),
      sip({ customerName: 'Şirin İnşaat' }),
      sip({ customerName: 'Çelik Yapı' }),
    ]);
    expect(r.tekrarEden).toBe(1);
    expect(r.benzersiz).toBe(2);
    expect(r.isimsiz).toBe(0);
  });

  it('MUTASYON AYIRT EDİCİ: adsız 2 sipariş "1 tekrar eden alıcı" ÜRETMEZ', () => {
    // Eski `custMap[o.customerName]` → anahtar "undefined": farklı müşterilerin adsız kayıtları
    // tek kovaya düşüp sadakat rakamı uyduruyordu.
    const r = tekrarEdenAlicilar([
      sip({ customerName: undefined }),
      sip({ customerName: null }),
      sip({ customerName: '   ' }),
    ]);
    expect(r.tekrarEden).toBe(0);
    expect(r.benzersiz).toBe(0);
    expect(r.isimsiz).toBe(3);
  });
});

describe('nakitPozisyonu — günlük nakit kısmi toplamdır, sahte ₺0 değil', () => {
  const BUGUN = '2026-09-19';

  it('SAYFA PARİTESİ: tutarlar biliniyorken üç rakam da eskiyle birebir', () => {
    const n = nakitPozisyonu([
      sip({ totalPrice: 40_000, paid: true, createdAt: '2026-09-19T09:00:00+03:00' }),
      sip({ totalPrice: 25_000, paid: false, createdAt: '2026-09-19T11:00:00+03:00' }),
      sip({ totalPrice: 90_000, paid: false, createdAt: '2026-09-10T11:00:00+03:00' }),
      sip({ totalPrice: 5_000, paid: false, status: 'Cancelled', createdAt: '2026-09-19T12:00:00+03:00' }),
    ], { gun: BUGUN });
    expect(n.bugunCiro.toplam).toBe(65_000);
    expect(n.bugunTahsil.toplam).toBe(40_000);
    expect(n.toplamAlacak.toplam).toBe(115_000);   // 25.000 + 90.000
  });

  it('MUTASYON AYIRT EDİCİ: bugünkü tutarsız sipariş ₺0 sayılmaz, SAYILIR', () => {
    const n = nakitPozisyonu([
      sip({ totalPrice: 40_000, paid: true, createdAt: '2026-09-19T09:00:00+03:00' }),
      sip({ totalPrice: null, paid: false, createdAt: '2026-09-19T10:00:00+03:00' }),
    ], { gun: BUGUN });
    expect(n.bugunCiro.toplam).toBe(40_000);
    expect(n.bugunCiro.bilinmeyen).toBe(1);
    expect(n.toplamAlacak.bilinmeyen).toBe(1);
  });

  it('bugün hiç bilinen tutar yoksa EKRAN değeri NaN ("—"), 0 değil', () => {
    // Tahsil edilmiş ama tutarı okunamayan sipariş: "bugün ₺0 tahsil ettik" DEMEK YANLIŞ.
    const n = nakitPozisyonu([
      sip({ totalPrice: null, paid: true, createdAt: '2026-09-19T10:00:00+03:00' }),
    ], { gun: BUGUN });
    expect(Number.isNaN(n.ekran.bugunCiro)).toBe(true);
    expect(Number.isNaN(n.ekran.bugunTahsil)).toBe(true);
  });

  it('hiç sipariş olmayan gün gerçek 0 (boş liste ≠ bilinmiyor)', () => {
    const n = nakitPozisyonu([sip({ totalPrice: 10_000, createdAt: '2026-09-01T10:00:00+03:00' })], { gun: BUGUN });
    expect(n.ekran.bugunCiro).toBe(0);
  });

  it('tarihi `createdAt` yoksa `syncedAt`ten okunur', () => {
    const n = nakitPozisyonu([
      sip({ totalPrice: 7_000, paid: true, createdAt: undefined, syncedAt: '2026-09-19T08:00:00+03:00' }),
    ], { gun: BUGUN });
    expect(n.bugunCiro.toplam).toBe(7_000);
  });

  // MUTASYON AYIRT EDİCİ: sayfa eskiden `bugunCiro.bilinmeyen + toplamAlacak.bilinmeyen`
  // topluyordu; iki küme KESİŞİR (bugün açılan sipariş çoğu zaman ödenmemiştir) ve tek kayıt
  // "2 kaydın tutarı okunamadı" diye raporlanıyordu.
  it('MUTASYON AYIRT EDİCİ: bugünkü ödenmemiş tutarsız TEK kayıt bir kez sayılır', () => {
    const n = nakitPozisyonu([
      sip({ totalPrice: 40_000, paid: true, createdAt: '2026-09-19T09:00:00+03:00' }),
      sip({ totalPrice: null, paid: false, createdAt: '2026-09-19T10:00:00+03:00' }),  // hem bugünkü hem açık alacak
    ], { gun: BUGUN });
    expect(n.bugunCiro.bilinmeyen).toBe(1);
    expect(n.toplamAlacak.bilinmeyen).toBe(1);
    expect(n.tutarsizKayit).toBe(1);               // naif toplam 2 derdi
  });

  it('kesişmeyen iki tutarsız kayıt (bugünkü ödenmiş + eski ödenmemiş) 2 sayılır', () => {
    const n = nakitPozisyonu([
      sip({ totalPrice: null, paid: true, createdAt: '2026-09-19T09:00:00+03:00' }),   // yalnız bugünkü ciroda
      sip({ totalPrice: null, paid: false, createdAt: '2026-09-02T09:00:00+03:00' }),  // yalnız açık alacakta
    ], { gun: BUGUN });
    expect(n.tutarsizKayit).toBe(2);
  });

  /**
   * MUTASYON AYIRT EDİCİ — açık alacak süzgecinin `odemeTakipli` yarısı. Bu blokta `source`
   * taşıyan fikstür yoktu: `:439`daki `filter(acikAlacakMi)` yerine `filter(o => o.paid !== true
   * && o.status !== 'Cancelled')` konunca 338 testin TAMAMI yeşil kalıyordu (Faz 3 5/n delta
   * bulgusu). Mikro'dan gelen siparişte `paid` HİÇ yazılmaz (tahsilat Mikro cari hesapta), yani
   * süzgeç gevşerse yüzlerce Mikro kaydı "Toplam Alacak" kartına açık alacak diye girer.
   * Fikstürlerin tarihi BUGÜN DEĞİL: Mikro kaydı bugünkü ciroya ADDITIVE olarak girer
   * (CLAUDE.md "EKLE, YERİNE KOYMA") ve orada haklı olarak sayılır — sınanan yalnız alacak yüzü.
   */
  it('MUTASYON AYIRT EDİCİ: Mikro kaynaklı ödenmemiş sipariş "Toplam Alacak"a GİRMEZ', () => {
    const n = nakitPozisyonu([
      sip({ totalPrice: 25_000, paid: false, createdAt: '2026-09-10T09:00:00+03:00' }),
      sip({ source: 'mikro-fatura', paid: false, totalPrice: 50_000, createdAt: '2026-09-10T09:00:00+03:00' }),
    ], { gun: BUGUN });
    expect(n.toplamAlacak.toplam).toBe(25_000);
    expect(n.toplamAlacak.bilinen).toBe(1);
  });

  it('MUTASYON AYIRT EDİCİ: tutarsız Mikro kaydı `tutarsizKayit` sayacını şişirmez', () => {
    const n = nakitPozisyonu([
      sip({ source: 'mikro-siparis', totalPrice: null, createdAt: '2026-09-10T09:00:00+03:00' }),
    ], { gun: BUGUN });
    expect(n.toplamAlacak.bilinmeyen).toBe(0);
    expect(n.tutarsizKayit).toBe(0);
  });

  it('iptal edilmiş tutarsız kayıt hiçbir kümeye girmez (sayaç şişmez)', () => {
    const n = nakitPozisyonu([
      sip({ totalPrice: null, paid: false, status: 'Cancelled', createdAt: '2026-09-19T09:00:00+03:00' }),
    ], { gun: BUGUN });
    expect(n.tutarsizKayit).toBe(0);
  });

  it('aynı tutarı/alanları taşıyan İKİ ayrı kayıt ayrı sayılır (değer değil kimlik eşleşir)', () => {
    // Nesne kimliğiyle tekilleştirme: alan bazlı bir "eşit mi" karşılaştırması bu ikisini
    // tek kayıt sanıp sayacı eksiltirdi.
    const ortak = { totalPrice: null, paid: false, createdAt: '2026-09-19T09:00:00+03:00' };
    const n = nakitPozisyonu([sip({ ...ortak }), sip({ ...ortak })], { gun: BUGUN });
    expect(n.tutarsizKayit).toBe(2);
  });
});

describe('finansKpilari — Phase 42 şeridinin tek çağrısı', () => {
  it('SAYFA PARİTESİ: bilinen girdide dört KPI da eskiyle birebir', () => {
    const siparisler = [
      sip({ customerName: 'Şirin İnşaat', totalPrice: 30_000, status: 'Delivered', paid: true }),
      sip({ customerName: 'Şirin İnşaat', totalPrice: 10_000, status: 'Delivered', paid: false }),
      sip({ customerName: 'Çelik Yapı', totalPrice: 20_000, status: 'Pending', paid: false }),
      sip({ customerName: 'Mehmet Usta Yapı Market', totalPrice: 20_000, status: 'Delivered', paid: true }),
    ];
    const k = finansKpilari({
      filtreliSiparisler: siparisler,
      siparisler,
      adaylar: [{ status: 'Closed Won' }, { status: 'Qualified' }, { status: 'New' }, { status: 'Proposal' }],
    });
    expect(k.aov.deger).toBe(20_000);
    expect(k.teslimat.oran).toBe(75);
    expect(k.donusum.oran).toBe(25);
    expect(k.tekrarAlici.tekrarEden).toBe(1);
    expect(k.tahsilat.oran).toBe(63);    // 50.000 / 80.000 = %62,5 → Math.round → 63 (para.ts tahsilatOrani)
  });

  it('MUTASYON AYIRT EDİCİ: boş panoda hiçbir KPI "0" iddia etmez', () => {
    const k = finansKpilari({ filtreliSiparisler: [], siparisler: [], adaylar: [] });
    expect(Number.isNaN(k.aov.deger)).toBe(true);
    expect(k.teslimat.oran).toBeNull();
    expect(k.donusum.oran).toBeNull();
    expect(k.tahsilat.oran).toBeNull();
    expect(k.tekrarAlici.tekrarEden).toBe(0);   // "tekrar eden alıcı yok" gerçek bir 0
  });
});

describe('esikUyarilari — değeri BİLİNMEYEN KPI için alarm çalınmaz', () => {
  const kurallar = [
    { id: 'kritikStok', esik: 0, yon: 'ustunde' as const, seviye: 'uyari' as const },
    { id: 'teslimatOrani', esik: 80, yon: 'altinda' as const, seviye: 'kritik' as const },
  ];

  it('SAYFA PARİTESİ: eşiği aşan KPI uyarı üretir', () => {
    const s = esikUyarilari({ kritikStok: 3, teslimatOrani: 60 }, kurallar);
    expect(s.uyarilar.map(u => u.id)).toEqual(['kritikStok', 'teslimatOrani']);
    expect(s.uyarilar[1].seviye).toBe('kritik');
    expect(s.veriYok).toEqual([]);
  });

  it('eşiği aşmayan KPI uyarı üretmez', () => {
    const s = esikUyarilari({ kritikStok: 0, teslimatOrani: 95 }, kurallar);
    expect(s.uyarilar).toEqual([]);
    expect(s.veriYok).toEqual([]);
  });

  it('MUTASYON AYIRT EDİCİ: değeri null olan KPI "0 < 80" diye SAHTE ALARM çalmaz, "veri yok" listelenir', () => {
    // `?? 0` geri konursa teslimatOrani=null vakası "%0 teslimat — KRİTİK" alarmı üretir.
    const s = esikUyarilari({ kritikStok: 0, teslimatOrani: null }, kurallar);
    expect(s.uyarilar).toEqual([]);
    expect(s.veriYok).toEqual(['teslimatOrani']);
  });

  it('MUTASYON AYIRT EDİCİ: KPI hiç verilmemişse (anahtar yok) de "veri yok"', () => {
    const s = esikUyarilari({ kritikStok: 0 }, kurallar);
    expect(s.veriYok).toEqual(['teslimatOrani']);
  });

  it('NaN değer de bilinmiyordur (ekranTutari NaN döndürebilir)', () => {
    const s = esikUyarilari({ kritikStok: NaN, teslimatOrani: 90 }, kurallar);
    expect(s.uyarilar).toEqual([]);
    expect(s.veriYok).toEqual(['kritikStok']);
  });
});
