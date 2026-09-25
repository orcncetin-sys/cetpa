/**
 * zamanDagilimi.test.ts — "siparişi tarihinden türeyen SABİT UZUNLUKTA indeksli kovalara yerleştir"
 * sözleşmesi. ÖNCE YAZILDI (Faz 3 6/n rapor ekranları, 2026-09-19).
 *
 * Sahte kesinlik siteleri (src/components/reports/genel/GenelOzet.tsx, HEAD 46c53a8):
 *   Phase 186 "Saate Göre Satış Dağılımı" (308-352)
 *     319  `if (bucket) { bucket.count++; bucket.rev += o.totalPrice || 0; }`
 *     324  `const peakBucket = hourBuckets186.reduce((best, b) => b.count > best.count ? b : best, hourBuckets186[0]);`
 *   Phase 147 "Güne Göre Satış Dağılımı" (355-396)
 *     365  `dayCounts[d.getDay()].revenue += o.totalPrice || 0;`
 *     370  `const bestDay = dayCounts.reduce((best, d) => d.revenue > best.revenue ? d : best, dayCounts[0]);`
 *
 * Üç ayrı arıza:
 *   (1) `|| 0` — tutarı BİLİNMEYEN sipariş o kovaya ₺0 yazıyor; kova cirosu sessizce eksik çıkıyor
 *       ve ekranda hiçbir iz kalmıyor (CLAUDE.md: bilinmeyen sayı 0 DEĞİL bilinmiyordur, SAYILIR).
 *   (2) `reduce(..., kovalar[0])` — hiç kayıt kovalanmadığında ya da tüm cirolar 0/bilinmeyen iken
 *       rozet yine de BASILIYOR: "Zirve: 0:00-2:59", "En iyi gün: Paz". Veri yokken üretilmiş sayı.
 *   (3) `find`/`if (bucket)` eşleşmezse öğe SESSİZCE düşüyor — kapsam dışı indeks sayılmıyor.
 *
 * Testler `tarihsiz` + `kapsamDisi` sayaçlarını, `Tutar` kovasını ve "tepe yoksa null" kuralını
 * kilitler; tarihi çözülen + kapsam içi girdide ADETLER `haftaIciIsiHaritasi` ile BİREBİR (test 1).
 */
import { describe, it, expect } from 'vitest';
import { zamanKovalari } from './zamanDagilimi';
import { haftaIciIsiHaritasi, type TarihliSiparis } from '../pano/stokSevkiyat';

// Türkçe fikstür: Şirin İnşaat'ın ÇİMENTO 50KG siparişleri (tutarlar TL).
interface Siparis extends TarihliSiparis {
  readonly musteri: string;
  readonly urun: string;
  readonly createdAt?: unknown;
  readonly syncedAt?: unknown;
  readonly totalPrice?: unknown;
}
const sip = (alan: Partial<Siparis>): Siparis =>
  ({ musteri: 'Şirin İnşaat', urun: 'ÇİMENTO 50KG', ...alan });

/** Yerel Date — `getDay()`/`getHours()` de yerel okunduğu için saat dilimi sonucu etkilemez. */
const t = (gun: number, saat = 10, dakika = 0): Date => new Date(2026, 8, gun, saat, dakika);

const gunIndeksi = (d: Date): number => d.getDay();
/** P186'nın kova kuralı: `h >= b.start && h < b.start + 3` ≡ `Math.floor(h / 3)`. */
const saatDilimi = (d: Date): number => Math.floor(d.getHours() / 3);
const tutarSec = (o: Siparis): unknown => o.totalPrice;

const SIFIR_CIRO = { toplam: 0, bilinen: 0, bilinmeyen: 0 };

describe('zamanKovalari', () => {
  // 1 · PARİTE — kapalı modül `stokSevkiyat.haftaIciIsiHaritasi` ile aynı adetler.
  // Fikstür TIE içerir (Pzt ve Çar ikişer sipariş): "beraberlikte İLK indeks" kuralını kilitler.
  it('haftaIciIsiHaritasi ile birebir aynı gün adetlerini ve tarihsiz sayısını üretir', () => {
    const liste: Siparis[] = [
      sip({ createdAt: t(14) }),                       // Pzt (1)
      sip({ createdAt: t(14, 16) }),                   // Pzt (1)
      sip({ createdAt: t(16) }),                       // Çar (3)
      sip({ createdAt: t(16, 9) }),                    // Çar (3)
      sip({ createdAt: t(18) }),                       // Cum (5)
      sip({ syncedAt: t(20) }),                        // createdAt YOK → yedek alan: Paz (0)
      sip({ createdAt: 'bozuk', syncedAt: t(15) }),    // alan VAR ama çözülemiyor → yedeğe DÜŞÜLMEZ
      sip({}),                                         // iki alan da yok
    ];

    const eski = haftaIciIsiHaritasi(liste);
    const yeni = zamanKovalari(liste, 7, gunIndeksi);

    expect(yeni.kovalar.map(k => k.adet)).toEqual(eski.sayilar);
    expect(yeni.kovalar.map(k => k.adet)).toEqual([1, 2, 0, 2, 0, 1, 0]);
    expect(yeni.tarihsiz).toBe(eski.tarihsiz);
    expect(yeni.tarihsiz).toBe(2);
    // TIE → İLK indeks (Pzt). Mutasyon "beraberlikte SON indeks" burada 3 (Çar) döner.
    expect(yeni.enYogun).toBe(eski.enYogunGun);
    expect(yeni.enYogun).toBe(1);
    expect(yeni.kapsamDisi).toBe(0);
    // `tutarSec` geçilmedi → ciro hiç okunmadı, tepe rozeti ÇİZİLMEZ.
    expect(yeni.kovalar.every(k => k.ciro.toplam === 0 && k.ciro.bilinen === 0)).toBe(true);
    expect(yeni.enCokCiro).toBeNull();
  });

  // 2 · P186 saat dilimi paritesi (8 kova × 3 saat).
  it('saat dilimi indeksiyle 8 kovaya yerleştirir', () => {
    const liste = [t(14, 9, 15), t(14, 10, 40), t(14, 23, 59)].map(d => sip({ createdAt: d }));
    const { kovalar, enYogun, tarihsiz, kapsamDisi } = zamanKovalari(liste, 8, saatDilimi);

    expect(kovalar).toHaveLength(8);
    expect(kovalar[3].adet).toBe(2);   // 09:15 + 10:40
    expect(kovalar[7].adet).toBe(1);   // 23:59
    expect(enYogun).toBe(3);
    expect(tarihsiz).toBe(0);
    expect(kapsamDisi).toBe(0);
  });

  // 3 · Tarihi çözülemeyen kayıt TARİHSİZ sayılır — hiçbir kovaya yazılmaz.
  // Mutasyon: `zamanDate` yerine `new Date(x)` yedeği → Invalid Date, `getDay()` NaN → kayıt
  // `kapsamDisi`'na kayar (ya da eski panellerdeki gibi sessizce düşer). Test `tarihsiz` ister.
  it('çözülemeyen tarihi tarihsiz sayar, kovaya yazmaz', () => {
    const liste = [sip({ createdAt: undefined }), sip({ createdAt: 'bozuk' })];
    const { kovalar, tarihsiz, kapsamDisi } = zamanKovalari(liste, 7, gunIndeksi);

    expect(tarihsiz).toBe(2);
    expect(kapsamDisi).toBe(0);
    expect(kovalar.every(k => k.adet === 0)).toBe(true);
  });

  // 4 · Veri yokken tepe UYDURULMAZ — eski `reduce(..., kovalar[0])` burada 0 dönüyordu
  // ("Zirve: 0:00-2:59" / "En iyi gün: Paz" rozeti boş panelde de basılıyordu).
  it('hiç kayıt kovalanmadıysa enYogun ve enCokCiro null döner', () => {
    const bos = zamanKovalari([] as Siparis[], 7, gunIndeksi, { tutarSec });
    expect(bos.enYogun).toBeNull();
    expect(bos.enCokCiro).toBeNull();

    const hepsiTarihsiz = zamanKovalari([sip({}), sip({ createdAt: null })], 7, gunIndeksi, { tutarSec });
    expect(hepsiTarihsiz.enYogun).toBeNull();
    expect(hepsiTarihsiz.enCokCiro).toBeNull();
    expect(hepsiTarihsiz.tarihsiz).toBe(2);
  });

  // 5 · Kova cirosunda bilinmeyen SAYILIR (eski `+= o.totalPrice || 0` o kovaya ₺0 yazıyordu).
  it('kova cirosunda bilinen toplanır, bilinmeyen sayılır', () => {
    const liste = [
      sip({ createdAt: t(14), totalPrice: 1000 }),
      sip({ createdAt: t(14, 15), totalPrice: null }),
    ];
    const { kovalar, enCokCiro } = zamanKovalari(liste, 7, gunIndeksi, { tutarSec });

    // Mutasyon `|| 0`: { toplam: 1000, bilinen: 2, bilinmeyen: 0 } → kırmızı.
    expect(kovalar[1].ciro).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 1 });
    expect(kovalar[1].adet).toBe(2);
    // KISMİ kova da rozet adayıdır (ekran yanına "N kayıt tutarsız" notu basar).
    expect(enCokCiro).toBe(1);
  });

  // 6 · Ciro seçicisi var ama hiçbiri bilinmiyor → ciro tepesi YOK, adet tepesi VAR.
  it('tüm cirolar bilinmiyorsa enCokCiro null, enYogun dolu kalır', () => {
    const liste = [
      sip({ createdAt: t(16), totalPrice: undefined }),
      sip({ createdAt: t(16, 11), totalPrice: 'abc' }),
      sip({ createdAt: t(18), totalPrice: null }),
    ];
    const { kovalar, enYogun, enCokCiro } = zamanKovalari(liste, 7, gunIndeksi, { tutarSec });

    expect(enYogun).toBe(3);
    expect(enCokCiro).toBeNull();
    expect(kovalar[3].ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
  });

  // 7 · MEŞRU ₺0 ciro tepe DEĞİLDİR — "en iyi gün" rozeti ₺0 üstüne basılmaz.
  it('bilinen ama sıfır ciro tepe adayı olmaz', () => {
    const liste = [sip({ createdAt: t(18), totalPrice: 0 })];
    const { kovalar, enYogun, enCokCiro } = zamanKovalari(liste, 7, gunIndeksi, { tutarSec });

    expect(kovalar[5].ciro).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
    expect(enYogun).toBe(5);       // adet tepesi meşru
    expect(enCokCiro).toBeNull();  // ciro tepesi YOK
  });

  // 7b · Ciro beraberliğinde de İLK indeks.
  it('eşit ciroda ilk kova tepe olur', () => {
    const liste = [
      sip({ createdAt: t(16), totalPrice: 500 }),
      sip({ createdAt: t(18), totalPrice: 500 }),
    ];
    expect(zamanKovalari(liste, 7, gunIndeksi, { tutarSec }).enCokCiro).toBe(3);
  });

  // 8 · Kapsam dışı indeks SESSİZCE düşmez, SAYILIR (eski `if (bucket)` izsiz eliyordu).
  it('aralık dışı ve tam sayı olmayan indeksi kapsamDisi sayar', () => {
    // Saatten indeks üreten sahte seçici (kovaSayisi = 3).
    const sapkinIndeks = (d: Date): number => {
      const h = d.getHours();
      if (h === 1) return -1;   // aralığın ALTI
      if (h === 2) return 3;    // aralığın ÜSTÜ (=== kovaSayisi, HARİÇ)
      if (h === 3) return 2.5;  // tam sayı DEĞİL
      return 0;                 // geçerli
    };
    const liste = [t(14, 1), t(14, 2), t(14, 3), t(14, 4)].map(d => sip({ createdAt: d }));
    const { kovalar, kapsamDisi, tarihsiz, enYogun } = zamanKovalari(liste, 3, sapkinIndeks);

    expect(kapsamDisi).toBe(3);
    expect(tarihsiz).toBe(0);
    expect(kovalar.map(k => k.adet)).toEqual([1, 0, 0]);
    expect(enYogun).toBe(0);
  });

  // 9 · DEĞİŞMEZ: hiçbir kayıt kaybolmaz.
  it('Σ adet + tarihsiz + kapsamDisi === liste.length', () => {
    const liste: Siparis[] = [
      sip({ createdAt: t(14, 2) }),        // geçerli gün
      sip({ createdAt: t(16, 4) }),        // geçerli gün
      sip({ createdAt: 'bozuk' }),         // tarihsiz
      sip({}),                             // tarihsiz
      sip({ createdAt: t(18, 6) }),        // kapsam dışı (aşağıdaki seçici 9 döndürür)
    ];
    const indeks = (d: Date): number => (d.getHours() === 6 ? 9 : d.getDay());
    const { kovalar, tarihsiz, kapsamDisi } = zamanKovalari(liste, 7, indeks);

    const kovalanan = kovalar.reduce((a, k) => a + k.adet, 0);
    expect(kovalanan + tarihsiz + kapsamDisi).toBe(liste.length);
    expect({ kovalanan, tarihsiz, kapsamDisi }).toEqual({ kovalanan: 2, tarihsiz: 2, kapsamDisi: 1 });
  });

  // 10 · Geçersiz kova sayısı sessiz boş sonuç değil HATA; girdi hiç değişmez.
  it('kovaSayisi pozitif tam sayı değilse throw eder ve girdiyi bozmaz', () => {
    const liste = [sip({ createdAt: t(14), totalPrice: 250 })];
    const oncesi = structuredClone(liste.map(o => ({ ...o, createdAt: String(o.createdAt) })));

    expect(() => zamanKovalari(liste, 0, gunIndeksi)).toThrow();
    expect(() => zamanKovalari(liste, 1.5, gunIndeksi)).toThrow();
    expect(() => zamanKovalari(liste, -7, gunIndeksi)).toThrow();
    expect(() => zamanKovalari(liste, Number.NaN, gunIndeksi)).toThrow();

    zamanKovalari(liste, 7, gunIndeksi, { tutarSec });
    expect(liste.map(o => ({ ...o, createdAt: String(o.createdAt) }))).toEqual(oncesi);
    expect(liste).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6b EKİ (2026-09-24): `mevsimsellikEndeksi` — GenelBloklar3.tsx:553-598 (Ciro Mevsimsellik Endeksi)
//   :560 `monthRevenue[m].push(o.totalPrice);`                        → bilinmeyen tutar `undefined` → :565 reduce NaN → ay kayboluyor
//   :565 `vals.length > 0 ? Σ/len : 0`                                  → boş ay 0 (veri yok ≠ ciro sıfır)
//   :567 `… / Math.max(1, monthAvg.filter(v=>v>0).length)`              → sahte payda; süzgeç iki kez
//   :572 `peakMonth = seasonality.reduce(…, -1)`                        → -1 kalırsa "peak: undefined"
// Aynı taban GenelBloklar6.tsx:140-156 (×100 biçim). Ay ortalaması TÜRETMEdir (tamTutar): kısmi toplamdan üretilmez.
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { mevsimsellikEndeksi, type ZamanKovasi } from './zamanDagilimi';

/** Bilinen tutarlı ay kovası: `adet` sipariş, toplam `ciro` TL (Şirin İnşaat ÇİMENTO 50KG). */
const ay = (adet: number, ciro: number): ZamanKovasi => ({ adet, ciro: { toplam: ciro, bilinen: adet, bilinmeyen: 0 } });
const bosAy = (): ZamanKovasi => ({ adet: 0, ciro: SIFIR_CIRO });
/** İçinde tutarı okunamayan sipariş olan ay. */
const tutarsizAy = (bilinen: number, ciro: number, tutarsiz: number): ZamanKovasi =>
  ({ adet: bilinen + tutarsiz, ciro: { toplam: ciro, bilinen, bilinmeyen: tutarsiz } });

describe('mevsimsellikEndeksi — 6b eki', () => {
  // GB3:563-569 eski formül: monthAvg = Σ/len; overallAvg = Σ(avg>0)/n(avg>0); seasonality = avg/overallAvg.
  const oniki = [ay(1, 100), ay(2, 400), ay(3, 900), ay(4, 1600), ...Array.from({ length: 8 }, bosAy)];

  it('PARİTE: 4 ölçülen ay (ort. 100/200/300/400) → genel 250; endeksler [0.4, 0.8, 1.2, 1.6, null×8]; zirve 3', () => {
    const m = mevsimsellikEndeksi(oniki);
    expect(m.endeksler.slice(0, 4).map(e => (e === null ? null : Number(e.toFixed(6))))).toEqual([0.4, 0.8, 1.2, 1.6]);
    expect(m.endeksler.slice(4)).toEqual(Array.from({ length: 8 }, () => null));
    expect(m.endeksler).toHaveLength(12);
    expect(m.olculenAy).toBe(4);
    expect(m.verisizAy).toBe(8);
    expect(m.tutarsizAy).toBe(0);
    expect(m.zirve).toBe(3);
    // Eski formülle BİREBİR (kendi hesabımızla değil, eski kodun aritmetiğiyle)
    const monthAvg = [100, 200, 300, 400, 0, 0, 0, 0, 0, 0, 0, 0];
    const overallAvg = monthAvg.filter(v => v > 0).reduce((s, v) => s + v, 0) / monthAvg.filter(v => v > 0).length;
    expect(m.endeksler[2]).toBeCloseTo(300 / overallAvg, 12);
  });

  it('MUTASYON-AYIRT EDİCİ: tutarsız ay ÖLÇÜLMEZ (null, tutarsizAy) ve tabana GİRMEZ — diğer endeksler değişmez', () => {
    const temiz = mevsimsellikEndeksi([ay(1, 100), ay(1, 300), ...Array.from({ length: 10 }, bosAy)]);
    // Aynı iki ay + üçüncü ayda 2 bilinen (₺1.000) + 1 tutarsız → kısmi ortalama 500 tabana girseydi genel 300 olurdu.
    const kirli = mevsimsellikEndeksi([ay(1, 100), ay(1, 300), tutarsizAy(2, 1000, 1), ...Array.from({ length: 9 }, bosAy)]);
    expect(kirli.endeksler[2]).toBeNull();
    expect(kirli.tutarsizAy).toBe(1);
    expect(kirli.olculenAy).toBe(2);
    expect(kirli.endeksler[0]).toBe(temiz.endeksler[0]);   // 100/200 = 0.5 (mutasyon: ekranTutari → 100/300)
    expect(kirli.endeksler[1]).toBe(temiz.endeksler[1]);
    expect(kirli.endeksler[0]).toBeCloseTo(0.5, 12);
  });

  it('AYRIK sayaçlar — çift sayım YOK: tutarsız ay verisizAy\'a DA sayılmaz; olculenAy + tutarsizAy + verisizAy === 12', () => {
    const karisik = [ay(2, 500), tutarsizAy(1, 200, 2), bosAy(), ay(3, 0), tutarsizAy(0, 0, 1), ...Array.from({ length: 7 }, bosAy)];
    const m = mevsimsellikEndeksi(karisik);
    expect(m.olculenAy).toBe(1);
    expect(m.tutarsizAy).toBe(2);
    expect(m.verisizAy).toBe(9);           // 8 boş + 1 meşru ₺0 ortalama
    expect(m.olculenAy + m.tutarsizAy + m.verisizAy).toBe(12);
  });

  it('zirve YOK: hiç ölçülen ay yoksa endeksler hepsi null, zirve null, olculenAy 0 (mutasyon: -1 → monthNames[-1] "peak: undefined")', () => {
    const bos = mevsimsellikEndeksi(Array.from({ length: 12 }, bosAy));
    expect(bos.endeksler).toEqual(Array.from({ length: 12 }, () => null));
    expect(bos.zirve).toBeNull();
    expect(bos.olculenAy).toBe(0);
    expect(bos.verisizAy).toBe(12);
    const hepsiTutarsiz = mevsimsellikEndeksi([tutarsizAy(1, 100, 1), tutarsizAy(0, 0, 2), ...Array.from({ length: 10 }, bosAy)]);
    expect(hepsiTutarsiz.endeksler.every(e => e === null)).toBe(true);
    expect(hepsiTutarsiz.zirve).toBeNull();
    expect(hepsiTutarsiz.olculenAy).toBe(0);
    expect(hepsiTutarsiz.tutarsizAy).toBe(2);
    expect(hepsiTutarsiz.verisizAy).toBe(10);
  });

  it('beraberlik: iki ay aynı endekste → zirve KÜÇÜK indeks (`>`, `>=` değil)', () => {
    const m = mevsimsellikEndeksi([ay(1, 100), ay(2, 800), ay(1, 400), ay(4, 1600), ...Array.from({ length: 8 }, bosAy)]);
    expect(m.endeksler[1]).toBe(m.endeksler[3]);
    expect(m.zirve).toBe(1);
  });

  it('meşru ₺0 ay (parite): 3 bilinen ₺0 sipariş → endeks null, verisizAy artar (bugünkü `avg > 0` süzgeci)', () => {
    const m = mevsimsellikEndeksi([ay(3, 0), ay(1, 100), ...Array.from({ length: 10 }, bosAy)]);
    expect(m.endeksler[0]).toBeNull();
    expect(m.verisizAy).toBe(11);
    expect(m.tutarsizAy).toBe(0);
    expect(m.olculenAy).toBe(1);
  });

  it('tek ölçülen ay: endeksi tam 1, diğerleri null, zirve o ay', () => {
    const m = mevsimsellikEndeksi([bosAy(), bosAy(), ay(5, 2500), ...Array.from({ length: 9 }, bosAy)]);
    expect(m.endeksler[2]).toBe(1);
    expect(m.endeksler.filter(e => e !== null)).toHaveLength(1);
    expect(m.zirve).toBe(2);
  });

  it('zamanKovalari çıktısıyla uçtan uca: tutarı okunamayan sipariş o ayı ölçülemez yapar', () => {
    const liste = [
      sip({ createdAt: new Date(2026, 0, 5), totalPrice: 100 }),
      sip({ createdAt: new Date(2026, 1, 5), totalPrice: 300 }),
      sip({ createdAt: new Date(2026, 2, 5), totalPrice: 500 }),
      sip({ createdAt: new Date(2026, 2, 9) }),                     // Mart — tutarı OKUNAMADI
    ];
    const z = zamanKovalari(liste, 12, d => d.getMonth(), { tarihSec: o => o.createdAt, tutarSec });
    const m = mevsimsellikEndeksi(z.kovalar);
    expect(m.endeksler[2]).toBeNull();
    expect(m.tutarsizAy).toBe(1);
    expect(m.olculenAy).toBe(2);
    expect(m.endeksler[0]).toBeCloseTo(0.5, 12);
    expect(m.endeksler[1]).toBeCloseTo(1.5, 12);
    expect(m.zirve).toBe(1);
  });

  it('girdi mutasyona uğramaz (Object.freeze); uzunluk girdiden gelir (4 çeyrek kovası da çalışır)', () => {
    const donuk = Object.freeze([ay(1, 100), ay(1, 300), bosAy(), tutarsizAy(1, 50, 1)].map(k =>
      Object.freeze({ ...k, ciro: Object.freeze({ ...k.ciro }) })));
    expect(() => mevsimsellikEndeksi(donuk)).not.toThrow();
    const m = mevsimsellikEndeksi(donuk);
    expect(m.endeksler).toHaveLength(4);
    expect(m.endeksler[0]).toBeCloseTo(0.5, 12);
    expect(m.endeksler[2]).toBeNull();
    expect(m.endeksler[3]).toBeNull();
    expect(m.olculenAy + m.tutarsizAy + m.verisizAy).toBe(4);
  });
});
