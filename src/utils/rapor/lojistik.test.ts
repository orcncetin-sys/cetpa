/**
 * lojistik.test.ts — teslim süresi + zamanında teslim özeti sözleşmesi.
 * ÖNCE YAZILDI (Faz 3 6/n b "utils-lojistik", 2026-09-24).
 *
 * Kapatılan siteler (src/components/reports/genel/GenelBloklar1.tsx, P197 "Ortalama Sipariş Teslim Süresi",
 * HEAD 912d750 satır 287-350):
 *   :291, :300  `!!(m.deliveredAt || m.updatedAt)` · `zamanDate(m.deliveredAt) ?? zamanDate(m.updatedAt)`
 *               → K17 ihlali: gerçekleşen teslim `updatedAt`ten UYDURULUYORDU (test 2)
 *   :302-303    `Math.round(...)` ÖNCE, `days >= 0` SONRA → `-0 >= 0` DOĞRU; negatif süre "0 gün" olarak
 *               ortalamaya giriyordu (test 3)
 *   :294-304    çözülemeyen / sınır dışı kayıt `filter` ile SESSİZCE düşüyordu → artık SAYILIR (test 12)
 *   :307-308    `Math.min(...cycleTimes)` → boş listede `Infinity` (test 11)
 *   :310-320    satır içi kova eşleşmesi `d <= max` (max: 1|3|7|14|∞) → `dagilim.kovayaYerlestir` (test 1 parite)
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur; sessiz eleme YOK, SAYILIR.
 *
 * K17 — kullanıcının cümlesi (2026-09-19): "Önerin ok. Siparişin kendi teslim tarihini baz al. 2. soru kabul."
 * → gerçekleşen = YALNIZ `deliveredAt`; "zamanında" siparişin KENDİ `estimatedDelivery`sine göre;
 *   tahmini tarihi ya da `deliveredAt`i olmayan sipariş "ölçülemedi" (paydadan çıkar, sayısı ekranda).
 *
 * Her "bilinmeyen 0 sayılmaz" kuralı için MUTASYON-AYIRT EDİCİ vaka var (yorumda hangi mutasyonun kırdığı yazılı).
 */
import { describe, it, expect } from 'vitest';
import { teslimSureleri, type TeslimSiparisi } from './lojistik';
import type { KovaSiniri } from './dagilim';

const SAAT_MS = 3_600_000;
const GUN_MS = 24 * SAAT_MS;
/** Şirin İnşaat'ın ilk siparişi: 1 Eylül 2026 09:00 (YEREL saat — TZ'ye bağlı ayrıştırma yok). */
const T0 = new Date(2026, 8, 1, 9, 0, 0).getTime();

// Türkçe fikstür: Şirin İnşaat / Çelik Yapı'nın ÇİMENTO 50KG siparişleri (tutar TL).
interface Siparis extends TeslimSiparisi {
  readonly no: string;
  readonly musteri: string;
  readonly urun: string;
  readonly tutarTL: number;
  /** ESKİ kodun yedek alanları — modül bunları OKUMAMALI (K17). */
  readonly updatedAt?: unknown;
  readonly completedAt?: unknown;
}

let sira = 0;
const sip = (alan: Partial<Siparis> = {}): Siparis => ({
  no: `SIP-${++sira}`,
  musteri: 'Şirin İnşaat',
  urun: 'ÇİMENTO 50KG',
  tutarTL: 12_500,
  createdAt: new Date(T0),
  ...alan,
});
/** createdAt = T0, deliveredAt = T0 + `saat` saat (negatif olabilir — veri hatası vakası). */
const teslim = (saat: number, alan: Partial<Siparis> = {}): Siparis =>
  sip({ deliveredAt: new Date(T0 + saat * SAAT_MS), ...alan });
const teslimGun = (gun: number, alan: Partial<Siparis> = {}): Siparis => teslim(gun * 24, alan);

/** GB1 P197'nin kovaları — üstler HARİÇ (`dagilim.KovaSiniri.ust`): eski `max: 1|3|7|14|∞` + `d <= max` ile aynı küme. */
const GB1_KOVALARI: readonly KovaSiniri[] = [
  { etiket: '≤1 gün', ust: 2 },
  { etiket: '2-3', ust: 4 },
  { etiket: '4-7', ust: 8 },
  { etiket: '8-14', ust: 15 },
  { etiket: '15+', ust: Infinity },
];
/** GB1:303 `days < 365` — sınır HARİÇ, değer AYNEN 365 (K20). */
const GB1_SINIRI = { deger: 365, birim: 'gun' } as const;

/** GB1:310-320 ESKİ kova eşleşmesi (parite ölçüsü): `buckets.find(b => d <= b.max)`, max: 1|3|7|14|∞. */
function eskiKovaAdetleri(gunler: readonly number[]): number[] {
  const maxlar = [1, 3, 7, 14, Infinity];
  const adet = [0, 0, 0, 0, 0];
  for (const d of gunler) adet[maxlar.findIndex(m => d <= m)]++;
  return adet;
}

describe('teslimSureleri', () => {
  // 1 · PARİTE: bilinen girdide ortalama / min / maks / kova adetleri eski kodla BİREBİR.
  it('PARİTE: 0/2/5/9/20 günlük 5 teslimat — ortalama 7,2, min 0, maks 20, her kovada 1', () => {
    const gunler = [0, 2, 5, 9, 20];
    const s = teslimSureleri(gunler.map(g => teslimGun(g)), { ustSinir: GB1_SINIRI, kovalar: GB1_KOVALARI });

    expect(s.ortalamaGun.deger).toBe(7.2);            // eski: Math.round(36 / 5) = 7 — yuvarlama ÇAĞIRANDA
    expect(s.ortalamaGun.toplamGun).toBe(36);
    expect(s.ortalamaGun.olculen).toBe(5);
    expect(s.ortalamaGun.olculemeyen).toBe(0);
    expect(s.enHizliGun).toBe(0);
    expect(s.enYavasGun).toBe(20);
    expect(s.dagitim.kovalar.map(k => k.adet)).toEqual([1, 1, 1, 1, 1]);
    expect(s.dagitim.kovalar.map(k => k.adet)).toEqual(eskiKovaAdetleri(gunler));
    expect(s.dagitim.bilinmeyen).toBe(0);
    expect(s.dagitim.kapsamDisi).toBe(0);             // son kova ∞ → taşma YOK (hakem maddesi 4)
    expect(s.tarihsiz).toBe(0);
    expect(s.kapsamDisi).toBe(0);

    // Tam sayı günlerin HEPSİ (0..30) eski `d <= max` eşleşmesiyle aynı kovaya düşer.
    // (Mutasyon: `ust` sınırları birer kaydırılırsa — [1,3,7,14,∞] — 1/3/7/14 günlük kayıtlar kova değiştirir.)
    const hepsi = Array.from({ length: 31 }, (_, g) => g);
    const s2 = teslimSureleri(hepsi.map(g => teslimGun(g)), { kovalar: GB1_KOVALARI });
    expect(s2.dagitim.kovalar.map(k => k.adet)).toEqual(eskiKovaAdetleri(hepsi));
    expect(s2.dagitim.kovalar.map(k => k.adet)).toEqual([2, 2, 4, 7, 16]);
  });

  // 2 · K17: yedek alan YOK.
  it('MUTASYON-AYIRT EDİCİ (K17): deliveredAt yoksa updatedAt/completedAt OKUNMAZ → tarihsiz, ölçüm yok', () => {
    const s = teslimSureleri([
      sip({ deliveredAt: undefined, updatedAt: new Date(T0 + 2 * GUN_MS), completedAt: new Date(T0 + 2 * GUN_MS) }),
    ]);
    // Eski davranış (`?? zamanMs(updatedAt)` eklenirse): olculen 1, deger 2.
    expect(s.tarihsiz).toBe(1);
    expect(s.ortalamaGun.olculen).toBe(0);
    expect(s.ortalamaGun.deger).toBeNull();
    expect(s.olcumler).toEqual([]);
    expect(s.olculemedi).toBe(1);                      // zamanında da ölçülemez — AYRI sayaç, toplanmaz
    expect(s.ortalamaGun.olculemeyen).toBe(1);         // 2 DEĞİL: aynı sipariş iki kez sayılmaz
  });

  // 3 · B2: negatif süre veri hatasıdır, ölçüm değil.
  it('MUTASYON-AYIRT EDİCİ (B2): teslim tarihi oluşturmadan 5 saat ÖNCE → kapsamDisi, 0 gün DEĞİL', () => {
    const s = teslimSureleri([teslim(-5)], { ustSinir: GB1_SINIRI });
    // Eski kapı `Math.round(-5/24) = -0` → `-0 >= 0` DOĞRU → ortalamaya 0 gün giriyordu.
    // (Mutasyon: kapı yuvarlanmış `gun >= 0`a çevrilirse olculen 1, deger 0.)
    expect(s.kapsamDisi).toBe(1);
    expect(s.tarihsiz).toBe(0);
    expect(s.ortalamaGun.olculen).toBe(0);
    expect(s.ortalamaGun.deger).toBeNull();
    expect(s.olcumler).toEqual([]);
  });

  // 4 · Aynı gün teslimat: gün 0 (+0), saat ham.
  it('aynı gün (+4 saat) teslimat → gun 0 (Object.is +0), saat 4, kova "≤1 gün"', () => {
    const s = teslimSureleri([teslim(4)], { kovalar: GB1_KOVALARI });
    expect(s.olcumler).toHaveLength(1);
    expect(s.olcumler[0].saat).toBe(4);
    expect(Object.is(s.olcumler[0].gun, 0)).toBe(true);   // -0 DEĞİL; (Mutasyon: Math.ceil → 1)
    expect(s.dagitim.kovalar[0].adet).toBe(1);
    expect(s.dagitim.kovalar[0].etiket).toBe('≤1 gün');
    expect(s.enHizliGun).toBe(0);
    expect(s.enYavasGun).toBe(0);
  });

  // 5 · ustSinir gün, HARİÇ (GB1 paritesi: `days < 365`).
  it('üst sınır { 365, gun } HARİÇ: 364 gün ÖLÇÜLÜR, tam 365 gün kapsamDisi', () => {
    const s = teslimSureleri([teslimGun(364), teslimGun(365)], { ustSinir: GB1_SINIRI });
    // (Mutasyon: `<` → `<=` olursa 365 de ölçülür: olculen 2.)
    expect(s.ortalamaGun.olculen).toBe(1);
    expect(s.enYavasGun).toBe(364);
    expect(s.kapsamDisi).toBe(1);
    expect(s.tarihsiz).toBe(0);
  });

  // 6 · ustSinir gün, DÂHİL (6k 60 g paritesi).
  it('üst sınır { 60, gun, dahil } : 60 gün ÖLÇÜLÜR, 61 gün kapsamDisi', () => {
    const s = teslimSureleri([teslimGun(60), teslimGun(61)], { ustSinir: { deger: 60, birim: 'gun', dahil: true } });
    // (Mutasyon: `dahil` yok sayılırsa 60 da elenir: olculen 0.)
    expect(s.ortalamaGun.olculen).toBe(1);
    expect(s.enYavasGun).toBe(60);
    expect(s.kapsamDisi).toBe(1);
  });

  // 7 · ustSinir saat, DÂHİL (6k 8.760 s paritesi) — birimlerin AYRI olmasının nedeni.
  it('üst sınır { 8760, saat, dahil } : tam 8.760,0 saat ÖLÇÜLÜR, 8.760,5 saat kapsamDisi; aynı kayıt GÜN biriminde içeride', () => {
    const liste = [teslim(8760), teslim(8760.5)];
    const s = teslimSureleri(liste, { ustSinir: { deger: 8760, birim: 'saat', dahil: true } });
    // (Mutasyon: `birim` yok sayılıp hep güne uygulanırsa 8.760,5 saat = 365,02 gün → 365 ≤ 8760 → ölçüme girer.)
    expect(s.ortalamaGun.olculen).toBe(1);
    expect(s.olcumler[0].saat).toBe(8760);
    expect(s.kapsamDisi).toBe(1);

    // Aynı iki kayıt, gün biriminde: 8.760,5 saat → Math.round(365,02) = 365 ≤ 365 → İÇERİDE.
    const g = teslimSureleri(liste, { ustSinir: { deger: 365, birim: 'gun', dahil: true } });
    expect(g.ortalamaGun.olculen).toBe(2);
    expect(g.kapsamDisi).toBe(0);
  });

  // 8 · Üst sınır verilmezse modül sınır UYDURMAZ.
  it('üst sınır verilmezse 5 yıllık kayıt ÖLÇÜLÜR (kapsamDisi 0), dagitim null', () => {
    const s = teslimSureleri([teslimGun(5 * 365)]);
    expect(s.ortalamaGun.olculen).toBe(1);
    expect(s.enYavasGun).toBe(5 * 365);
    expect(s.kapsamDisi).toBe(0);
    expect(s.dagitim).toBeNull();
  });

  // 9 · K17 zamanında / geç / ölçülemedi — `zamanindaTeslimat` sözleşmesi, değişmezle.
  it('MUTASYON-AYIRT EDİCİ (K17): 1 gün önce / 2 gün sonra / tahminsiz / teslimsiz → 1 zamanında, 1 geç, 2 ölçülemedi', () => {
    const tahmin = new Date(T0 + 5 * GUN_MS);
    const liste = [
      sip({ musteri: 'Çelik Yapı', estimatedDelivery: tahmin, deliveredAt: new Date(T0 + 4 * GUN_MS) }), // (a) 1 gün ÖNCE
      sip({ estimatedDelivery: tahmin, deliveredAt: new Date(T0 + 7 * GUN_MS) }),                        // (b) 2 gün SONRA
      sip({ deliveredAt: new Date(T0 + 3 * GUN_MS) }),                                                   // (c) tahmin YOK
      sip({ estimatedDelivery: tahmin }),                                                                // (d) deliveredAt YOK
    ];
    const s = teslimSureleri(liste, { ustSinir: GB1_SINIRI });
    // (Mutasyon: tahmini olmayan kayıt "zamanında" sayılırsa — OrdersPage'in eski arızası — zamaninda 2.)
    expect(s.zamaninda).toBe(1);
    expect(s.gec).toBe(1);
    expect(s.olculemedi).toBe(2);
    expect(s.zamanindaOrani).toBe(50);
    expect(s.zamaninda + s.gec + s.olculemedi).toBe(liste.length);   // DEĞİŞMEZ

    // İki örneklem AYRI ve KESİŞİR: (d) hem `tarihsiz` hem `olculemedi` — TOPLANMAZ.
    expect(s.tarihsiz).toBe(1);
    expect(s.ortalamaGun.olculen).toBe(3);                            // (a) (b) (c) süresi ölçülür
    expect(s.ortalamaGun.olculemeyen).toBe(1);                        // 3 DEĞİL (tarihsiz + olculemedi toplanmaz)
  });

  // 10 · Takvim günü kuralı — lojistikKpi.test.ts ile AYNI kural, kopya sözleşme yok.
  it('söz verilen günün akşamı yapılan teslimat GEÇ sayılmaz (takvim günü — lojistikKpi kuralı)', () => {
    const s = teslimSureleri([
      sip({ createdAt: '2026-09-08T10:00:00', estimatedDelivery: '2026-09-10', deliveredAt: '2026-09-10T18:30:00' }),
    ]);
    // (Mutasyon: ham ms karşılaştırması → 18:30 > 00:00 → geç.)
    expect(s.zamaninda).toBe(1);
    expect(s.gec).toBe(0);
    expect(s.zamanindaOrani).toBe(100);
  });

  // 11 · Hiç ölçüm yok: türetilen sayılar null, sayaçlar dolu, kovalar 0.
  it('MUTASYON-AYIRT EDİCİ: hiç deliveredAt yok → ortalama/min/maks null, tarihsiz = ölçülemedi = n, kovalar 0', () => {
    const liste = [sip(), sip(), sip({ musteri: 'Çelik Yapı' }), sip()];
    const s = teslimSureleri(liste, { ustSinir: GB1_SINIRI, kovalar: GB1_KOVALARI });
    // (Mutasyon: `olculen > 0 ? … : 0` → "0 gün" sahte kesinliği; `Math.min(...[])` → Infinity.)
    expect(s.ortalamaGun.deger).toBeNull();
    expect(s.enHizliGun).toBeNull();
    expect(s.enYavasGun).toBeNull();
    expect(s.tarihsiz).toBe(4);
    expect(s.olculemedi).toBe(4);
    expect(s.olcumler).toEqual([]);
    expect(s.dagitim.kovalar.map(k => k.adet)).toEqual([0, 0, 0, 0, 0]);
    expect(s.dagitim.bilinmeyen).toBe(0);
    expect(s.dagitim.kapsamDisi).toBe(0);
    expect(s.zamanindaOrani).toBeNull();
  });

  // 12 · Kısmi ölçüm + değişmezler.
  it('kısmi ölçüm: 3 ölçülebilir + 2 tarihsiz + 1 sınır dışı → ortalama YALNIZ 3\'ten; sayaç değişmezleri tutar', () => {
    const liste = [
      teslimGun(2), teslimGun(5), teslimGun(9),
      sip({ createdAt: undefined, deliveredAt: new Date(T0 + GUN_MS) }),   // createdAt çözülemez → tarihsiz
      sip(),                                                                // deliveredAt yok → tarihsiz
      teslimGun(400),                                                       // 365 sınırı aşıldı → kapsamDisi
    ];
    const s = teslimSureleri(liste, { ustSinir: GB1_SINIRI, kovalar: GB1_KOVALARI });
    expect(s.ortalamaGun.deger).toBe(16 / 3);
    expect(s.ortalamaGun.toplamGun).toBe(16);
    expect(s.ortalamaGun.olculen).toBe(3);
    expect(s.ortalamaGun.olculemeyen).toBe(3);
    expect(s.tarihsiz).toBe(2);
    expect(s.kapsamDisi).toBe(1);
    expect(s.ortalamaGun.olculen + s.ortalamaGun.olculemeyen).toBe(liste.length);
    expect(s.ortalamaGun.olculemeyen).toBe(s.tarihsiz + s.kapsamDisi);
    const kovaToplami = s.dagitim.kovalar.reduce((a, k) => a + k.adet, 0);
    expect(kovaToplami + s.dagitim.bilinmeyen + s.dagitim.kapsamDisi).toBe(s.olcumler.length);
    expect(s.dagitim.kovalar.map(k => k.adet)).toEqual([0, 1, 1, 1, 0]);
    expect(s.enHizliGun).toBe(2);
    expect(s.enYavasGun).toBe(9);
  });

  // 13 · Şekil ve dokunulmazlık.
  it('girdi dokunulmaz, nesne kimliği korunur, kovalar yoksa dagitim null', () => {
    const girdi = Object.freeze([Object.freeze(teslimGun(3)), Object.freeze(sip())]);
    const once = JSON.stringify(girdi);
    const s = teslimSureleri(girdi);
    expect(JSON.stringify(girdi)).toBe(once);
    expect(s.olcumler[0].siparis).toBe(girdi[0]);      // aynı nesne (tooltip sipariş no basabilsin)
    expect(s.dagitim).toBeNull();
    expect(s.tarihsiz).toBe(1);
  });

  it('tarih biçimleri (Date, ISO, TR "10.09.2026", Firestore { seconds }) AYNI ölçümü verir — ayrıştırma zaman.ts\'indir', () => {
    const bas = new Date(2026, 8, 1);          // 1 Eylül 2026 00:00 yerel
    const son = new Date(2026, 8, 10);         // 10 Eylül 2026 00:00 yerel → 9 gün = 216 saat
    const liste = [
      sip({ createdAt: bas, deliveredAt: son }),
      sip({ createdAt: '2026-09-01T00:00:00', deliveredAt: '2026-09-10T00:00:00' }),
      sip({ createdAt: '01.09.2026', deliveredAt: '10.09.2026' }),
      sip({ createdAt: { seconds: bas.getTime() / 1000 }, deliveredAt: { seconds: son.getTime() / 1000, nanoseconds: 0 } }),
    ];
    const s = teslimSureleri(liste, { kovalar: GB1_KOVALARI });
    expect(s.tarihsiz).toBe(0);
    expect(s.olcumler.map(m => m.gun)).toEqual([9, 9, 9, 9]);
    expect(s.olcumler.map(m => m.saat)).toEqual([216, 216, 216, 216]);
    expect(s.dagitim.kovalar.map(k => k.adet)).toEqual([0, 0, 0, 4, 0]);
  });

  // 14 · `dagitim.kapsamDisi` (histogram taşması) ≠ üst düzey `kapsamDisi` (eleme sınırı) — hakem maddesi 4.
  it('histogram taşması ile eleme sınırı AYRI sayaçlardır (son kova sonluysa taşan ölçüm dagitim.kapsamDisi)', () => {
    const sonlu: readonly KovaSiniri[] = [{ etiket: '0-1', ust: 2 }, { etiket: '2-14', ust: 15 }];
    const liste = [teslimGun(1), teslimGun(20), teslim(-3)];
    const s = teslimSureleri(liste, { kovalar: sonlu });
    expect(s.olcumler.map(m => m.gun)).toEqual([1, 20]);   // 20 gün ÖLÇÜLDÜ (eleme sınırı yok)
    expect(s.kapsamDisi).toBe(1);                          // yalnız negatif kayıt
    expect(s.dagitim.kapsamDisi).toBe(1);                  // yalnız 20 günlük taşma
    expect(s.dagitim.kovalar.map(k => k.adet)).toEqual([1, 0]);
    const kovaToplami = s.dagitim.kovalar.reduce((a, k) => a + k.adet, 0);
    expect(kovaToplami + s.dagitim.bilinmeyen + s.dagitim.kapsamDisi).toBe(s.olcumler.length);

    // GB1 kovaları (son kova ∞) aynı ölçümlerde taşma üretmez.
    const g = teslimSureleri(liste, { kovalar: GB1_KOVALARI });
    expect(g.dagitim.kapsamDisi).toBe(0);
    expect(g.kapsamDisi).toBe(1);
  });

  // 15 · ustSinir saat, HARİÇ — 2×2 matrisin dördüncü hücresi.
  it('üst sınır { 24, saat } HARİÇ: 23,5 saat ÖLÇÜLÜR, tam 24 saat kapsamDisi', () => {
    const s = teslimSureleri([teslim(23.5), teslim(24)], { ustSinir: { deger: 24, birim: 'saat' } });
    expect(s.ortalamaGun.olculen).toBe(1);
    expect(s.olcumler[0].saat).toBe(23.5);
    expect(s.kapsamDisi).toBe(1);
  });

  // 16 · Geçersiz sınır programcı hatasıdır — sessizce "hepsi kapsam dışı" ÜRETİLMEZ (dagilim.ts emsali).
  it('geçersiz üst sınır (NaN / negatif) fırlatır; Infinity = sınır yok', () => {
    expect(() => teslimSureleri([teslimGun(1)], { ustSinir: { deger: NaN, birim: 'gun' } })).toThrow(/üst sınır/);
    expect(() => teslimSureleri([teslimGun(1)], { ustSinir: { deger: -1, birim: 'saat' } })).toThrow(/üst sınır/);
    expect(teslimSureleri([teslimGun(5000)], { ustSinir: { deger: Infinity, birim: 'gun' } }).ortalamaGun.olculen).toBe(1);
  });
});
