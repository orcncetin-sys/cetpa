/**
 * lojistikKpi.test.ts — OrdersPage lojistik/destek KPI sözleşmesi.
 * ÖNCE YAZILDI (Faz 3 4/n "lojistikKpi", 2026-09-19).
 *
 * Kapatılan sahte-kesinlik siteleri (src/pages/OrdersPage.tsx, satırlar yaklaşık):
 *   ~2627 fillRate     = periodOrders.length > 0 ? … : 0     siparişsiz dönem "%0 doluluk" + KIRMIZI rozet
 *   ~2628 onTimeRate   = delivered576.length > 0 ? … : 0     teslimatsız dönem "%0 zamanında"
 *   ~2629 cancelRate   = periodOrders.length > 0 ? … : 0     siparişsiz dönem "%0 iptal" + YEŞİL rozet
 *   ~2622-2625 onTime576 filtresi                            tahmini teslim tarihi YOKSA "zamanında" sayılıyordu;
 *                                                            fotoğrafı olmayan teslimat da `est <= est` ile zamanında
 *   ~2631-2636 avgProcessDays = shipped576.reduce(…)/len : 0 sevkiyatsız dönem "0 gün" + YEŞİL "≤3 gün" rozeti;
 *                                                            `crMs === null` dalı toplamı atlayıp PAYDADA bırakıyordu
 *   ~2637-2638 lowStockRatio = inventory.length > 0 ? … : 0  ürünsüz katalog "%0 düşük stok" + YEŞİL rozet
 *   ~2851 totalValue   = p622Shipments.reduce(s+(sh.value||0)) değeri bilinmeyen sevkiyat 0 sayılıyor VE
 *                                                            USD/EUR/TRY tek toplamda birleşip `paraYaz(…,'USD')`
 *                                                            ile hepsi dolar gibi basılıyordu
 *   ~1572-1573 avgSatScore = reduce(s+(t.satisfaction||0))   aralık dışı/metin puan toplama sızıyordu
 *   ~2648-2653 cargoMap576 `(cargoMap576[c]||0) + 1`         SAYAÇ — meşru, dokunulmuyor
 *
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur — türetmeye
 * girmez, SAYILIR, ekranda '—' olur; oran hesaplanamıyorsa null ve yüzde rozeti ÇİZİLMEZ.
 */
import { describe, it, expect } from 'vitest';
import { paraYaz } from '../currency';
import { ekranTutari } from '../para';
import {
  oranYuzde,
  gecenGunOrtalamasi,
  zamanindaTeslimat,
  teslimPerformansi,
  ihracatToplami,
  ihracatToplamiYaz,
  memnuniyetOzeti,
  memnuniyetOrtalamasi,
} from './lojistikKpi';

const SIMDI = new Date(2026, 8, 19, 12, 0, 0); // 19 Eyl 2026 12:00 (yerel)
const GUN = 86400000;
const gunOnce = (n: number) => new Date(SIMDI.getTime() - n * GUN);
const PENCERE = { baslangic: gunOnce(30), bitis: SIMDI };

// ── Fikstür: 30 günlük dönemdeki siparişler (inşaat malzemesi toptancısı) ─────────────────
const SIPARISLER = [
  { id: 'S1', customerName: 'Şirin İnşaat', status: 'Delivered', createdAt: gunOnce(5), cargoCompany: 'Aras Kargo' },
  { id: 'S2', customerName: 'Çelik Yapı', status: 'Shipped', createdAt: gunOnce(3), cargoCompany: 'Yurtiçi Kargo' },
  { id: 'S3', customerName: 'Işık Ltd.', status: 'Cancelled', createdAt: gunOnce(10) },
  { id: 'S4', customerName: 'Ömer Nakliyat', status: 'Pending', createdAt: gunOnce(1) },
  { id: 'S5', customerName: 'Güneş A.Ş.', status: 'Processing', createdAt: gunOnce(2) },
];

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('oranYuzde — payda 0/bilinmiyorsa oran YOK', () => {
  it('SAYFA PARİTESİ: bilinen girdide eski `pay/payda*100` ile birebir', () => {
    expect(oranYuzde(2, 5)).toBe((2 / 5) * 100);
    expect(oranYuzde(1, 3)).toBe((1 / 3) * 100);
  });

  it('MUTASYON-AYIRT EDİCİ: payda 0 → null (eski `: 0` "%0" basıyordu)', () => {
    expect(oranYuzde(0, 0)).toBeNull();
    expect(oranYuzde(3, 0)).toBeNull();
  });

  it('MUTASYON-AYIRT EDİCİ: bilinmeyen pay/payda 0 SAYILMAZ', () => {
    expect(oranYuzde(null, 5)).toBeNull();
    expect(oranYuzde(2, undefined)).toBeNull();
    expect(oranYuzde(2, 'abc')).toBeNull();
    expect(oranYuzde(2, NaN)).toBeNull();
  });

  it('negatif payda oran üretmez', () => {
    expect(oranYuzde(2, -5)).toBeNull();
  });

  it('meşru 0 pay gerçek %0 döner (bilinmeyenle karıştırılmaz)', () => {
    expect(oranYuzde(0, 5)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('gecenGunOrtalamasi — tarihi okunamayan sipariş ortalamaya GİRMEZ, sayılır', () => {
  it('SAYFA PARİTESİ: tarihleri bilinen siparişlerde eski ortalama ile birebir', () => {
    const liste = [{ createdAt: gunOnce(5) }, { createdAt: gunOnce(3) }];
    const eski = ((SIMDI.getTime() - gunOnce(5).getTime()) / GUN + (SIMDI.getTime() - gunOnce(3).getTime()) / GUN) / 2;
    const s = gecenGunOrtalamasi(liste, SIMDI);
    expect(s.ortalama).toBe(eski);
    expect(s.ortalama).toBe(4);
    expect(s.olculen).toBe(2);
    expect(s.olculemeyen).toBe(0);
  });

  it('MUTASYON-AYIRT EDİCİ: okunamayan tarih PAYDADA da yok (eski kod 8/3 = 2,67 basardı)', () => {
    const liste = [{ createdAt: gunOnce(5) }, { createdAt: gunOnce(3) }, { createdAt: null }];
    const s = gecenGunOrtalamasi(liste, SIMDI);
    expect(s.ortalama).toBe(4); // 8/2 — 8/3 DEĞİL
    expect(s.olculen).toBe(2);
    expect(s.olculemeyen).toBe(1); // sayılır, yutulmaz
  });

  it('MUTASYON-AYIRT EDİCİ: hiç ölçülebilir sipariş yoksa ortalama null (eski `: 0` "0 gün" + yeşil rozet)', () => {
    expect(gecenGunOrtalamasi([], SIMDI).ortalama).toBeNull();
    expect(gecenGunOrtalamasi([{ createdAt: 'yok' }], SIMDI).ortalama).toBeNull();
  });

  it('"şimdi" okunamazsa hiçbir şey ölçülmez (uydurma süre yok)', () => {
    const s = gecenGunOrtalamasi([{ createdAt: gunOnce(5) }], new Date('gecersiz'));
    expect(s.ortalama).toBeNull();
    expect(s.olculemeyen).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('zamanindaTeslimat — iki tarih de bilinmiyorsa ÖLÇÜLEMEZ (eski kod "zamanında" sayıyordu)', () => {
  const TESLIMATLAR = [
    { id: 'T1', estimatedDelivery: '2026-09-10', deliveredAt: '2026-09-09' }, // erken
    { id: 'T2', estimatedDelivery: '2026-09-10', deliveredAt: '2026-09-12' }, // geç
    { id: 'T3', estimatedDelivery: undefined, deliveredAt: '2026-09-09' },    // tahmin yok
    { id: 'T4', estimatedDelivery: '2026-09-10', deliveredAt: undefined },    // gerçek teslim yok
  ];

  it('MUTASYON-AYIRT EDİCİ: tahmini teslim tarihi olmayan kayıt "zamanında" SAYILMAZ', () => {
    const s = zamanindaTeslimat(TESLIMATLAR);
    expect(s.olculen).toBe(2);        // yalnız T1 + T2
    expect(s.olculemeyen).toBe(2);    // T3 + T4 sayılır
    expect(s.zamaninda).toBe(1);
    expect(s.oran).toBe(50);          // eski kod: 3/4 → %75 (T3 ve T4 "zamanında")
  });

  it('MUTASYON-AYIRT EDİCİ: hiç ölçülebilir teslimat yoksa oran null (eski kod %100 ya da %0)', () => {
    expect(zamanindaTeslimat([{ estimatedDelivery: undefined, deliveredAt: undefined }]).oran).toBeNull();
    expect(zamanindaTeslimat([]).oran).toBeNull();
  });

  it('aynı gün teslim GECİKME sayılmaz (gün bazlı karşılaştırma)', () => {
    const s = zamanindaTeslimat([{ estimatedDelivery: '2026-09-10', deliveredAt: '2026-09-10T18:30:00' }]);
    expect(s.zamaninda).toBe(1);
    expect(s.oran).toBe(100);
  });

  it('Türk biçimi tarih (DD.MM.YYYY) doğru okunur', () => {
    const s = zamanindaTeslimat([{ estimatedDelivery: '10.09.2026', deliveredAt: '09.09.2026' }]);
    expect(s.zamaninda).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('teslimPerformansi — Phase 576 KPI kartları', () => {
  it('SAYFA PARİTESİ: bilinen girdide doluluk/iptal/ortalama eskiyle birebir', () => {
    const s = teslimPerformansi(SIPARISLER, PENCERE);
    expect(s.donem).toHaveLength(5);
    expect(s.sevkEdilen).toBe(2);
    expect(s.teslimEdilen).toBe(1);
    expect(s.iptal).toBe(1);
    expect(s.aktif).toBe(2);
    expect(s.dolulukOrani).toBe((2 / 5) * 100); // eski fillRate
    expect(s.iptalOrani).toBe((1 / 5) * 100);   // eski cancelRate
    expect(s.ortGecenGun).toBe(4);              // eski avgProcessDays: (5+3)/2
    expect(s.tarihsiz).toBe(0);
  });

  it('dönem dışı sipariş KPI\'lara girmez, `donem` çağıran için filtrelenmiş liste döndürür', () => {
    const s = teslimPerformansi([...SIPARISLER, { id: 'S9', customerName: 'Eski Müşteri', status: 'Delivered', createdAt: gunOnce(120) }], PENCERE);
    expect(s.donem).toHaveLength(5);
    expect(s.donem.map(o => o.id)).not.toContain('S9');
    expect(s.tarihsiz).toBe(0); // dönem dışı ≠ tarihi bilinmiyor
  });

  it('MUTASYON-AYIRT EDİCİ: pencerenin ÜST sınırı da geçerli — bitişten SONRA tarihli sipariş döneme girmez', () => {
    // `ms >= bas && ms <= bit` içindeki `&& ms <= bit` hiçbir fikstürle sabitlenmemişti:
    // tüm `createdAt` değerleri geçmişe bakıyordu, yani üst sınır silinse suite yeşil kalıyordu
    // (2026-09-19 kapanış bulgusu). Üst sınır paritenin parçası — eski sayfa kodu `d <= now576`
    // diyordu. İleri tarihli kayıt gerçektir: elle girilen tarih, saat kayması, Mikro'dan gelen
    // planlı kayıt; ya da modül geçmiş bir dönemle (önceki dönem karşılaştırması) çağrılır.
    const s = teslimPerformansi(
      [...SIPARISLER, { id: 'S10', customerName: 'İleri Tarihli Yapı', status: 'Delivered', createdAt: new Date(SIMDI.getTime() + GUN) }],
      PENCERE,
    );
    expect(s.donem).toHaveLength(5);
    expect(s.donem.map(o => o.id)).not.toContain('S10');
    expect(s.tarihsiz).toBe(0);
    expect(s.teslimEdilen).toBe(1);   // yalnız S1; S10 teslim oranını şişirmez
  });

  it('sınırlar DAHİLDİR: tam başlangıç ve tam bitiş anındaki sipariş döneme girer', () => {
    const s = teslimPerformansi(
      [
        { id: 'B1', customerName: 'Sınır Başı', status: 'Delivered', createdAt: gunOnce(30) },
        { id: 'B2', customerName: 'Sınır Sonu', status: 'Delivered', createdAt: SIMDI },
      ],
      PENCERE,
    );
    expect(s.donem.map(o => o.id)).toEqual(['B1', 'B2']);
  });

  it('MUTASYON-AYIRT EDİCİ: tarihi okunamayan sipariş dönemden düşer ama SAYILIR', () => {
    const s = teslimPerformansi([...SIPARISLER, { id: 'S8', customerName: 'Tarihsiz Yapı', status: 'Delivered', createdAt: undefined }], PENCERE);
    expect(s.tarihsiz).toBe(1);
    expect(s.donem).toHaveLength(5);
    expect(s.sevkEdilen).toBe(2);              // S8 doluluk oranını şişirmez
    expect(s.dolulukOrani).toBe((2 / 5) * 100);
  });

  it('MUTASYON-AYIRT EDİCİ: boş dönemde her oran null — "%0 doluluk / %0 iptal / 0 gün" YOK', () => {
    const s = teslimPerformansi([], PENCERE);
    expect(s.dolulukOrani).toBeNull();
    expect(s.iptalOrani).toBeNull();
    expect(s.zamanindaOrani).toBeNull();
    expect(s.ortGecenGun).toBeNull();
    expect(s.donem).toHaveLength(0);
  });

  it('MUTASYON-AYIRT EDİCİ: teslimat var ama tahmini tarih yoksa zamanında oranı null (eski %100)', () => {
    const s = teslimPerformansi(SIPARISLER, PENCERE);
    expect(s.zamanindaOrani).toBeNull();
    expect(s.zamanindaOlculemeyen).toBe(1); // S1 teslim edildi, tahmini tarih yok
  });

  it('BİLİNÇLİ FARK: zamanında teslim gerçek `deliveredAt` ile ölçülür (eski kod fotoğraf/yaklaşıklık kullanıyordu)', () => {
    const liste = [
      { id: 'D1', customerName: 'Şirin İnşaat', status: 'Delivered', createdAt: gunOnce(6), estimatedDelivery: gunOnce(3), deliveredAt: gunOnce(4) },
      { id: 'D2', customerName: 'Çelik Yapı', status: 'Delivered', createdAt: gunOnce(8), estimatedDelivery: gunOnce(5), deliveredAt: gunOnce(2) },
    ];
    const s = teslimPerformansi(liste, PENCERE);
    expect(s.zamanindaOlculen).toBe(2);
    expect(s.zamanindaOrani).toBe(50); // D1 zamanında, D2 gecikmeli
  });

  it('iptal edilen sipariş sevkiyat/aktif sayılmaz', () => {
    const s = teslimPerformansi([{ id: 'X', customerName: 'Işık Ltd.', status: 'Cancelled', createdAt: gunOnce(2) }], PENCERE);
    expect(s.iptalOrani).toBe(100);
    expect(s.dolulukOrani).toBe(0); // meşru %0 — bilinmeyen değil
    expect(s.aktif).toBe(0);
  });

  it('okunamayan pencere sınırı uydurma dönem üretmez', () => {
    const s = teslimPerformansi(SIPARISLER, { baslangic: new Date('gecersiz'), bitis: SIMDI });
    expect(s.donem).toHaveLength(0);
    expect(s.dolulukOrani).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('ihracatToplami — farklı para birimleri TEK toplamda birleşmez', () => {
  const SEVKIYATLAR = [
    { id: 'IH1', destination: 'Bağdat', currency: 'USD', value: 10000 },
    { id: 'IH2', destination: 'Erbil', currency: 'USD', value: 5000 },
    { id: 'IH3', destination: 'Sofya', currency: 'EUR', value: 2000 },
    { id: 'IH4', destination: 'Lefkoşa', currency: 'TRY', value: 150000 },
    { id: 'IH5', destination: 'Tiflis', currency: 'USD', value: undefined }, // tutarı bilinmiyor
  ];

  it('SAYFA PARİTESİ: tek para biriminde toplam eski `reduce` ile birebir', () => {
    const tekBirim = [
      { id: 'A', destination: 'Bağdat', currency: 'USD', value: 10000 },
      { id: 'B', destination: 'Erbil', currency: 'USD', value: 5000 },
    ];
    const s = ihracatToplami(tekBirim);
    expect(s.birimler).toHaveLength(1);
    expect(s.birimler[0].birim).toBe('USD');
    expect(ekranTutari(s.birimler[0].tutar)).toBe(15000);
    expect(ihracatToplamiYaz(s)).toBe(paraYaz(15000, { birim: 'USD', ondalik: 0 }));
  });

  it('MUTASYON-AYIRT EDİCİ: USD/EUR/TRY ayrı kovalarda — 167.000 diye tek sayı YOK', () => {
    const s = ihracatToplami(SEVKIYATLAR);
    const kova = Object.fromEntries(s.birimler.map(b => [b.birim, b.tutar]));
    expect(ekranTutari(kova.USD)).toBe(15000);
    expect(ekranTutari(kova.EUR)).toBe(2000);
    expect(ekranTutari(kova.TRY)).toBe(150000);
    // Eski davranış: 10000+5000+2000+150000 = 167000, hepsi "$" ile basılıyordu
    expect(s.birimler.some(b => ekranTutari(b.tutar) === 167000)).toBe(false);
  });

  it('MUTASYON-AYIRT EDİCİ: tutarı bilinmeyen sevkiyat 0 sayılmaz, SAYILIR', () => {
    const s = ihracatToplami(SEVKIYATLAR);
    const usd = s.birimler.find(b => b.birim === 'USD');
    expect(usd?.tutar.toplam).toBe(15000);
    expect(usd?.tutar.bilinen).toBe(2);
    expect(usd?.tutar.bilinmeyen).toBe(1); // IH5
    expect(s.bilinmeyenTutar).toBe(1);
  });

  it('MUTASYON-AYIRT EDİCİ: para birimi bilinmeyen sevkiyat hiçbir birimin toplamına girmez', () => {
    const s = ihracatToplami([...SEVKIYATLAR, { id: 'IH6', destination: 'Kayıp', currency: '', value: 500 }]);
    expect(s.birimler.map(b => b.birim)).not.toContain('');
    expect(s.birimsiz.bilinen + s.birimsiz.bilinmeyen).toBe(1);
    expect(s.birimler.reduce((a, b) => a + b.tutar.toplam, 0)).toBe(167000); // 500 hiçbir kovaya girmedi
  });

  it('birim sırası sabit (TRY, USD, EUR, sonra alfabetik) — tutar büyüklüğüne göre DEĞİL', () => {
    const s = ihracatToplami([
      { id: 'A', destination: 'Sofya', currency: 'EUR', value: 2000 },
      { id: 'B', destination: 'Doha', currency: 'AED', value: 900 },
      { id: 'C', destination: 'Lefkoşa', currency: 'TRY', value: 150000 },
      { id: 'D', destination: 'Bağdat', currency: 'USD', value: 15000 },
    ]);
    expect(s.birimler.map(b => b.birim)).toEqual(['TRY', 'USD', 'EUR', 'AED']);
  });

  it('küçük harf/boşluklu para birimi kodu aynı kovaya düşer', () => {
    const s = ihracatToplami([
      { id: 'A', destination: 'Bağdat', currency: ' usd ', value: 100 },
      { id: 'B', destination: 'Erbil', currency: 'USD', value: 200 },
    ]);
    expect(s.birimler).toHaveLength(1);
    expect(ekranTutari(s.birimler[0].tutar)).toBe(300);
  });

  it('ihracatToplamiYaz: kovalar " + " ile, sevkiyat yoksa "—"', () => {
    // Her kova KENDİ birim yerelinde biçimlenir (paraYaz): TRY tr-TR, USD en-US, EUR de-DE.
    expect(ihracatToplamiYaz(ihracatToplami(SEVKIYATLAR))).toBe('₺150.000 + $15,000 + €2.000');
    expect(ihracatToplamiYaz(ihracatToplami([]))).toBe('—');
  });

  it('MUTASYON-AYIRT EDİCİ: tamamı bilinmeyen kova "0" değil "— <BİRİM>" basar', () => {
    const s = ihracatToplami([{ id: 'A', destination: 'Londra', currency: 'GBP', value: null }]);
    expect(ihracatToplamiYaz(s)).toBe('— GBP');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('memnuniyetOrtalamasi — Phase 609 destek bileti puanı', () => {
  it('SAYFA PARİTESİ: puanlı biletlerde eski ortalama ile birebir', () => {
    const talepler = [{ satisfaction: 5 }, { satisfaction: 4 }, { satisfaction: 3 }];
    expect(memnuniyetOrtalamasi(talepler)).toBe(4);
    expect(memnuniyetOrtalamasi(talepler)?.toFixed(1)).toBe('4.0');
  });

  it('SAYFA PARİTESİ: puansız bilet ortalamayı düşürmez (eski filtre de düşürmüyordu)', () => {
    expect(memnuniyetOrtalamasi([{ satisfaction: 5 }, { satisfaction: undefined }, { satisfaction: 3 }])).toBe(4);
  });

  it('MUTASYON-AYIRT EDİCİ: hiç puan yoksa null — 0 puan ortalaması YOK', () => {
    expect(memnuniyetOrtalamasi([])).toBeNull();
    expect(memnuniyetOrtalamasi([{ satisfaction: undefined }, { satisfaction: null }])).toBeNull();
  });

  it('MUTASYON-AYIRT EDİCİ: aralık dışı / metin puan toplama girmez (eski `||0` metni birleştiriyordu)', () => {
    expect(memnuniyetOrtalamasi([{ satisfaction: 5 }, { satisfaction: 0 }, { satisfaction: 7 }, { satisfaction: 'abc' }])).toBe(5);
  });

  it('memnuniyetOzeti oy ve oysuz bileti ayrı sayar (ekran notu için)', () => {
    const o = memnuniyetOzeti([{ satisfaction: 5 }, { satisfaction: 3 }, { satisfaction: undefined }, { satisfaction: 9 }]);
    expect(o.ortalama).toBe(4);
    expect(o.oy).toBe(2);
    expect(o.oysuz).toBe(2);
  });

  it('sayısal string puan kabul edilir (DB\'den string dönen kayıt)', () => {
    expect(memnuniyetOrtalamasi([{ satisfaction: '5' }, { satisfaction: '3' }])).toBe(4);
  });
});
