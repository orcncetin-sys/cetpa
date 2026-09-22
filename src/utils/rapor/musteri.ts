/**
 * musteri.ts — rapor katmanında MÜŞTERİ KİMLİĞİ ve müşteri özeti (Faz 3 6a, grup "musteri", 2026-09-19).
 * Test: musteri.test.ts (ÖNCE yazıldı, kırmızı görüldü).
 *
 * ## Neden var
 * Müşteri DÖRT sitede AD metniyle gruplanıyordu (HEAD 46c53a8'de ölçüldü):
 *   - `components/reports/useReportsData.ts:215-224` `topCustomers` — anahtar `o.customerName || '—'` (`:217`, trim'siz)
 *   - `pages/RaporlarPage.tsx:185-189`  PDF "En Yüksek Cirolu Müşteriler" `custMap` — anahtar `o.customerName || '—'` (`:187`)
 *   - `pages/RaporlarPage.tsx:270-277`  Aylık Özet "yeni müşteri" `ilkSiparisAyi` — anahtar `(o.customerName || '—').trim()` (`:274`)
 *   - `pages/RaporlarPage.tsx:107-123`  sentetik Mikro siparişi — cari KODU hiçbir alana yazılmıyor, yalnız
 *     `customerName: cariAdMap.get(f.cariKod) || f.cariKod || '—'` (`:111`) ile ada sızıyor; kimlik KAYBOLUYOR.
 * Sonuç: aynı adlı İKİ firma tek müşteri, adı iki türlü yazılmış TEK firma iki müşteri, adsız siparişlerin
 * tamamı ise '—' adlı SAHTE bir müşteri oluyordu ("yeni müşteri" sayısı da bu sahte kaydı sayıyordu).
 *
 * ## UYGULANAN KULLANICI KARARI — K4 (KARARLAR.md, 2026-09-19 ikinci tur), kullanıcının cümlesi:
 *   "Müşteriyi adla mı kimlikle mi gruplayacağız → kimlikle."
 *   (Kimlik = müşteri kaydı ya da Mikro cari kodu; AD yalnız kimliği olmayan siparişte yedek; ikisi de
 *    yoksa "kimliksiz N sipariş" NOTU — satır değil. Aynı müşterinin Cetpa kaydı ile Mikro carisi
 *    `mikroCariKod` bağıyla TEK müşteri sayılır.)
 * PLAN-v2.md §4'ün "ad öncelikli" önerisi kullanıcı tarafından REDDEDİLDİ; bu modül kimlik önceliklidir.
 *
 * ## Ölçüm — sipariş hangi kimliği taşıyor
 *   Cetpa siparişi               `leadId` (`types.ts:121`; yazıcı `App.tsx:3076`, cari seçilmeden açılan siparişte `null`)
 *   Faturadan TÜRETİLEN sipariş  `mikroCariKod` (`server/mikro/eslemeFatura.ts:259`; `Order` tipinde YOK, yapısal okunur)
 *   Sentetik Mikro siparişi      HİÇBİRİ (`RaporlarPage.tsx:107-123` — bağlama ADDITIVE `mikroCariKod` ekler)
 *   Bağ (Cetpa kaydı ↔ cari)     `Lead.mikroCariKod` (`types.ts:274`) — sipariş üzerinde DEĞİL, lead üzerinde
 * `customerId` zincire ALINMADI: siparişe yazan hiçbir kod yok (tek yazıcı `customerRisks`, `App.tsx:2890`);
 * var olmayan alanı okumak sahte güvendir. Yazıcı doğarsa ADDITIVE eklenir.
 *
 * ## Parite
 * Tek kimlikli, adı tutarlı müşteride ciro ve adet eski ad-anahtarlı `reduce` ile BİREBİR.
 * ## Bilinçli farklar (hepsi K4 gereği)
 *   - Aynı adlı FARKLI kayıtlar AYRILIR; aynı kaydın farklı yazımları BİRLEŞİR → "en yüksek cirolu
 *     müşteriler" sırası/tutarları değişebilir.
 *   - Adsız siparişler '—' adlı müşteri OLMAZ (satır kalkar, yerine kapsam notu); Aylık Özet "yeni müşteri"
 *     sayısı adsızların oluşturduğu 1 sahte müşteri kadar AZALIR.
 *   - Bağ haritası verildiğinde Cetpa siparişi + aynı carinin Mikro faturası TEK satırda toplanır (eskiden
 *     ad tutarsa birleşiyor, tutmazsa ayrılıyordu — tesadüfe bağlıydı).
 *   - `topCustomers` anahtarı artık trim'li (eski `:217` trim'sizdi: 'Şirin İnşaat ' ayrı müşteri oluyordu).
 *
 * Saf modül: React / DB / metin / dil YOK. Tarih ÇÖZMEZ (çağıran `zaman.zamanMs` verir), sipariş durumu
 * OKUMAZ — iptal süzgeci ÇAĞIRANDADIR (K2: tek kural `raporVeriKatmani.raporCirosu`).
 */
import { toplaBilinen, ekranTutari, sayiSirala, type Tutar } from '../para';

export type MusteriAnahtarTuru = 'cari' | 'kayit' | 'ad';

/** Yapısal girdi — kanonik `Order`, faturadan türetilmiş ve sentetik Mikro siparişi uyar. */
export interface KimlikliSiparis { leadId?: unknown; mikroCariKod?: unknown; customerName?: unknown }

export interface MusteriKimligi {
  /** Önekli, çakışmasız: 'cari:<kod>' | 'kayit:<leadId>' | 'ad:<trim'li ad>'. Ekrana BASILMAZ (React key / Map anahtarı). */
  anahtar: string;
  tur: MusteriAnahtarTuru;
  /** Öneksiz ham değer (cari kodu / lead id / ad). */
  kimlik: string;
}

export interface MusteriCozumSecenegi {
  /** lead.id → lead.mikroCariKod. VERİLMEZSE Cetpa kaydı ile Mikro carisi BİRLEŞTİRİLMEZ (uydurma yok). */
  leadCariKodu?: ReadonlyMap<string, string>;
}

/**
 * "Dolu metin" = `typeof === 'string'` ve `trim() !== ''`. Sayı / nesne / boolean / `null` kimlik ya da ad
 * DEĞİLDİR: `String(x)` KULLANILMAZ — yoksa 'undefined', 'null', '[object Object]' adlı müşteriler doğar.
 */
function doluMetin(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t === '' ? null : t;
}

/**
 * Üç yazıcının (RaporlarPage.tsx:111, eslemeFatura.ts:258, eski `|| '—'` siteleri) uydurduğu yer tutucu:
 * ad DEĞİLDİR. Başka yer tutucu ('Unknown', '-') EKLENMEZ — yazıcısı ölçülmedi.
 */
const YER_TUTUCU_AD = '—';

/**
 * Anahtar zinciri (kimlik ÖNCELİKLİ): `mikroCariKod` → `leadId` (bağ varsa cari) → ad yedeği → null.
 *
 * MODÜL İÇİ (2026-09-22 düzeltme turu): dışa açıktı ama hiçbir ÜRETİM dosyası içe aktarmıyordu —
 * `components/reports/rapor6a.degismez.test.ts` §2 ("her export en az bir üretim dosyasınca içe
 * aktarılıyor") bu yüzden kırmızıydı ("yazıldı ama bağlanmadı"). Tek çağıranı `musteriOzeti`;
 * kapsamı `musteri.test.ts`te o satırlar üzerinden ölçülür. Yanındaki tek satırlık sarmalayıcı
 * `raporMusteriAnahtari` de SİLİNDİ (üretim satırları `anahtar` alanını ZATEN taşıyor).
 * Üretimde doğrudan bir çağrı gerekirse yeniden `export` edilir — tüketicisiyle BİRLİKTE.
 * Siparişin KENDİ cari kodu lead bağından ÖNCE gelir: belge o cariye kesilmiştir, lead sonradan başka
 * cariye bağlanmış olabilir. Cari kodu karşılaştırması trim + BİREBİR (emsal `useMikroFaturalar.ts:67`
 * `useCariAdMap`); büyük-küçük harf KATLANMAZ — Mikro harmanlaması teyitsiz.
 */
function raporMusteriKimligi(o: KimlikliSiparis, s?: MusteriCozumSecenegi): MusteriKimligi | null {
  const cariKod = doluMetin(o.mikroCariKod);
  if (cariKod !== null) return { anahtar: `cari:${cariKod}`, tur: 'cari', kimlik: cariKod };

  const leadId = doluMetin(o.leadId);
  if (leadId !== null) {
    // K4: "Aynı müşterinin Cetpa kaydı ile Mikro carisi `mikroCariKod` bağıyla TEK müşteri sayılır."
    const bagliKod = s?.leadCariKodu ? doluMetin(s.leadCariKodu.get(leadId)) : null;
    if (bagliKod !== null) return { anahtar: `cari:${bagliKod}`, tur: 'cari', kimlik: bagliKod };
    return { anahtar: `kayit:${leadId}`, tur: 'kayit', kimlik: leadId };
  }

  // Ad YEDEĞİ — yalnız kimliksiz siparişte. Normalleştirme YALNIZ trim (`RaporlarPage.tsx:274` +
  // `finansKpi.tekrarEdenAlicilar` paritesi): harf katlama / `arama.katla` KULLANILMAZ, çünkü K4'ün
  // çözüm yolu siparişi KAYDA bağlamaktır, ad eşleştirmeyi akıllandırmak değil.
  const ad = doluMetin(o.customerName);
  if (ad !== null && ad !== YER_TUTUCU_AD) return { anahtar: `ad:${ad}`, tur: 'ad', kimlik: ad };

  return null;
}

/**
 * Lead listesinden bağ haritası — RaporlarPage ve `useReportsData` AYNI fonksiyonu çağırır (kopya döngü
 * yazılmaz). `id` ve `mikroCariKod` dolu metin olmayan lead ATLANIR (boş kodla bağ kurulmaz). Aynı koda
 * bağlı iki lead (mükerrer kayıt) ikisi de aynı `cari:` kovasına düşer — doğru: aynı cari = aynı müşteri.
 * `useCariAdMap` (`useMikroFaturalar.ts:118`) bunun TERS yönlü kardeşidir (o: kod→ad; bu: leadId→kod).
 */
export function leadCariKoduHaritasi(
  leads: readonly { id?: unknown; mikroCariKod?: unknown }[],
): Map<string, string> {
  const harita = new Map<string, string>();
  for (const l of leads) {
    const id = doluMetin(l.id);
    const kod = doluMetin(l.mikroCariKod);
    if (id !== null && kod !== null) harita.set(id, kod);
  }
  return harita;
}

export interface MusteriSatiri<O> extends MusteriKimligi {
  /** O kimliğin EN SON siparişindeki dolu ad; hiç dolu ad yoksa `null` (ekran `kimlik`'i ya da '—' basar). */
  ad: string | null;
  adet: number;
  /** `toplaBilinen` sözleşmesi. EKRAN: `ekranTutari(ciro)` + `ciro.bilinmeyen` notu. TÜRETME (pay/ortalama): `tamTutar(ciro)`. */
  ciro: Tutar;
  ilkMs: number | null;
  sonMs: number | null;
  /** İlk / son TARİHLİ siparişin KENDİSİ — ay anahtarı `ayAnahtari(m.ilk.createdAt)` ile üretilir (ms→ay çevirisi saat dilimi farkı doğurur; parite için ham alan okunur). */
  ilk: O | null;
  son: O | null;
  /** Bu müşterinin tarihi çözülemeyen sipariş sayısı. */
  tarihsiz: number;
}

export interface MusteriOzeti<O> {
  /** Sıra = İLK GÖRÜLME (eski `Object.values(reduce)` / `Map` sırasıyla parite). */
  musteriler: MusteriSatiri<O>[];
  /** Kimliği de adı da olmayan sipariş — SATIR OLMAZ, not olur (`kapsamNotu({ kimliksiz })`). */
  kimliksiz: number;
  kimliksizCiro: Tutar;
  /** `tur === 'ad'` kovalarındaki SİPARİŞ sayısı (müşteri kaydına bağlı olmayan, adla gruplanan). */
  adlaGruplanan: number;
  /** Müşterisi BİLİNEN ama tarihi çözülemeyen sipariş. Kimliksizler buraya GİRMEZ (çift sayım yok). */
  tarihsiz: number;
  /** `siparisler.length`. */
  toplam: number;
}

/** Kova — dönen satırın iç hâli; `siparisler` sonunda `toplaBilinen`e verilir (kısmi toplam + sayaçlar). */
interface Kova<O> {
  kimlik: MusteriKimligi;
  siparisler: O[];
  ilkMs: number | null;
  sonMs: number | null;
  ilk: O | null;
  son: O | null;
  tarihsiz: number;
  /** Tarihli adaylar içinde ms'i en büyük olanın adı (eşitlikte girdide SONRAKİ). */
  adEnYeni: string | null;
  adEnYeniMs: number | null;
  /** Girdi sırasındaki SON aday — hiç tarihli aday yoksa kullanılır. */
  adSonGirdi: string | null;
}

/**
 * Müşteri özeti. `adet` ve `ciro` müşterinin TÜM siparişlerini kapsar (tarihsizler DAHİL — müşteri belli,
 * yalnız tarih bilinmiyor). Tutarı bilinmeyen sipariş 0 SAYILMAZ, `ciro.bilinmeyen`'de sayılır.
 *
 * İptal süzgeci ÇAĞIRANDADIR (K2 "iptaller ciroya GİRMEZ" — tek kural `raporVeriKatmani.raporCirosu`):
 * `musteriOzeti(iptalsiz, …)`. `tutarSec` içinde iptali NaN'a çevirmek YASAK — iptal "bilinmeyen tutar"
 * değildir; `ciro.bilinmeyen`'i şişirip "N kayıt tutarsız" notunu yalancı yapar.
 *
 * Girdi dizisi / öğeleri / `leadCariKodu` MUTASYONA uğramaz.
 */
export function musteriOzeti<O extends KimlikliSiparis>(
  siparisler: readonly O[],
  s: {
    tutarSec: (o: O) => unknown;
    tarihSec: (o: O) => number | null | undefined;
    leadCariKodu?: ReadonlyMap<string, string>;
  },
): MusteriOzeti<O> {
  const kovalar = new Map<string, Kova<O>>();
  const kimliksizler: O[] = [];
  let adlaGruplanan = 0;
  let tarihsiz = 0;

  for (const o of siparisler) {
    const kimlik = raporMusteriKimligi(o, { leadCariKodu: s.leadCariKodu });
    if (kimlik === null) {
      // Kimliksiz + tarihsiz sipariş YALNIZ `kimliksiz`de sayılır (sayaç anahtar kontrolünden SONRA artar).
      kimliksizler.push(o);
      continue;
    }

    let kova = kovalar.get(kimlik.anahtar);
    if (!kova) {
      kova = {
        kimlik, siparisler: [], ilkMs: null, sonMs: null, ilk: null, son: null,
        tarihsiz: 0, adEnYeni: null, adEnYeniMs: null, adSonGirdi: null,
      };
      kovalar.set(kimlik.anahtar, kova);
    }
    kova.siparisler.push(o);
    if (kimlik.tur === 'ad') adlaGruplanan++;

    // Tarih geçerli ⇔ sonlu SAYI (global `isFinite` DEĞİL): null / undefined / NaN / ±Infinity tarihsizdir.
    const ham = s.tarihSec(o);
    const ms = typeof ham === 'number' && Number.isFinite(ham) ? ham : null;
    if (ms === null) {
      kova.tarihsiz++;
      tarihsiz++;
    } else {
      // Eşit ms'te `ilk` = girdide ÖNCE gelen (strict <), `son` = girdide SONRA gelen (>=).
      if (kova.ilkMs === null || ms < kova.ilkMs) { kova.ilkMs = ms; kova.ilk = o; }
      if (kova.sonMs === null || ms >= kova.sonMs) { kova.sonMs = ms; kova.son = o; }
    }

    // Görünen ad adayı: dolu, '—' olmayan VE (tur !== 'ad' iken) o satırın `kimlik`'ine eşit OLMAYAN ad.
    // "Ad = kod" dışlaması `tur === 'cari'` içindir: yazıcılar unvanı bulamayınca adı cari KODUYLA
    // dolduruyor (`RaporlarPage.tsx:111` `|| f.cariKod`, `eslemeFatura.ts:258` `|| cariKod`) — en yeni
    // fatura kodla adlandırılmışsa eski GERÇEK unvan kaybolmasın. `tur === 'ad'` satırında ad = kimlik
    // olduğundan dışlama uygulanmaz (yoksa ad hep `null` olurdu).
    const adHam = doluMetin(o.customerName);
    const aday = adHam !== null && adHam !== YER_TUTUCU_AD && (kimlik.tur === 'ad' || adHam !== kimlik.kimlik)
      ? adHam
      : null;
    if (aday !== null) {
      kova.adSonGirdi = aday;
      if (ms !== null && (kova.adEnYeniMs === null || ms >= kova.adEnYeniMs)) {
        kova.adEnYeniMs = ms;
        kova.adEnYeni = aday;
      }
    }
  }

  const musteriler = [...kovalar.values()].map<MusteriSatiri<O>>(k => ({
    ...k.kimlik,
    ad: k.adEnYeniMs !== null ? k.adEnYeni : k.adSonGirdi,
    adet: k.siparisler.length,
    ciro: toplaBilinen(k.siparisler, s.tutarSec),
    ilkMs: k.ilkMs,
    sonMs: k.sonMs,
    ilk: k.ilk,
    son: k.son,
    tarihsiz: k.tarihsiz,
  }));

  return {
    musteriler,
    kimliksiz: kimliksizler.length,
    // Kimliksiz siparişlerin tutarı KAYBOLMAZ, yalnız müşteriye atfedilmez.
    kimliksizCiro: toplaBilinen(kimliksizler, s.tutarSec),
    adlaGruplanan,
    tarihsiz,
    toplam: siparisler.length,
  };
}

/**
 * Ciroya göre AZALAN kopya: tutarı bilinmeyen müşteri (NaN) SONDA — yön `-cmp` ile ÇEVRİLMEZ
 * (`para.sayiSirala` sözleşmesi). Beraberlikte İLK GÖRÜLME sırası korunur (kararlı sıralama).
 * Girdiyi DEĞİŞTİRMEZ.
 */
export function ciroSirali<O>(musteriler: readonly MusteriSatiri<O>[]): MusteriSatiri<O>[] {
  return [...musteriler].sort((a, b) => sayiSirala(ekranTutari(a.ciro), ekranTutari(b.ciro), true));
}
