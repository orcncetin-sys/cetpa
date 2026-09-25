/**
 * lojistik.ts — teslim süresi + zamanında teslim özeti, tek kaynak (Faz 3 6/n b "utils-lojistik", 2026-09-24).
 * Test: lojistik.test.ts (ÖNCE yazıldı). Saf modül — React / DB / ekrana basılan metin YOK.
 *
 * NEDEN VAR — `src/components/reports/genel/GenelBloklar1.tsx:287-350` (Phase 197 "Ortalama Sipariş
 * Teslim Süresi", HEAD 912d750) teslim süresini elle hesaplıyordu; dört arıza:
 *   :291, :300  `!!(m.deliveredAt || m.updatedAt)` · `zamanDate(m.deliveredAt) ?? zamanDate(m.updatedAt)`
 *               K17 İHLALİ: gerçekleşen teslim `updatedAt`ten UYDURULUYORDU. `updatedAt` her durum/not
 *               güncellemesinde değişir; "teslim süresi" aslında "son dokunuşa kadar geçen süre" idi.
 *   :294-304    çözülemeyen ve `days >= 0 && days < 365` dışı kayıt `null` → `filter` ile DÜŞÜYORDU:
 *               kaç kaydın düştüğü kullanıcıya HİÇ söylenmiyordu; ort./min/maks sessizce kısmiydi.
 *   :302-303    `Math.round(...)` ÖNCE, `days >= 0` SONRA: teslim tarihi oluşturmadan 12 saate kadar ÖNCE
 *               olan kayıt `-0`a yuvarlanıp `>= 0` kapısını GEÇİYOR ve ortalamaya 0 gün olarak giriyordu.
 *               Negatif süre bir ölçüm değil veri hatasıdır.
 *   :321, :342  `Math.max(...counts, 1)` · `Math.max(4, …)px` — boş kova 4 px hayalet çubuk çiziyordu
 *               (6a `OlcekCubugu` / `sayacOlcegi` kuralı; ölçek ÇAĞIRANDA, bu modül çizmez).
 * Aynı işin dört kopyası daha `LojistikRapor.tsx`te yaşıyor (:1346-1349 30 gün, :1664-1667 60 gün,
 * :1827-1831 sınırsız, :2023-2026 8.760 saat) — her biri kendi eşiği, kendi yedek alanı (`completedAt`)
 * ve kendi sessiz elemesiyle. 6k'da dördü de BURAYA bağlanır; bu yüzden üst eleme sınırı PARAMETREDİR
 * (`ustSinir`: gün/saat × hariç/dâhil — her tüketici KENDİ literal sayısını korur, K20), gövde
 * kopyalanmaz. 6k'da dosya BÜYÜR (`acikSiparisYaslari`, `kargoDagilimi`, `LOJISTIK_PUAN_AGIRLIKLARI`);
 * 6b'de YALNIZ `teslimSureleri`.
 *
 * K17 — KULLANICI KARARI (2026-09-19, KARARLAR.md), cümlesi AYNEN:
 *   "Önerin ok. Siparişin kendi teslim tarihini baz al. 2. soru kabul."
 *   Yorumu: gerçekleşen teslim = YALNIZ `deliveredAt` (yedek alan YOK: `updatedAt` de `completedAt` de
 *   OKUNMAZ); "zamanında" siparişin KENDİ `estimatedDelivery`sine göre; sabit "≤ 3 gün" kuralı KALKTI;
 *   tahmini tarihi ya da `deliveredAt`i olmayan sipariş "ölçülemedi" — üçüncü kova, paydadan çıkar,
 *   SAYISI EKRANDA.
 *
 * "Zamanında" hesabı burada YENİDEN YAZILMAZ: `siparisler/lojistikKpi.zamanindaTeslimat` (4/n, testli,
 * `gunFarki` TAKVİM GÜNÜ kuralıyla — söz verilen günün akşamı yapılan teslimat geç sayılmaz) ÇAĞRILIR.
 * İkinci bir "zamanında" tanımı iki ekranda iki farklı yüzde demekti.
 *
 * TAŞINAN NOT (GB1:297-299, kaybolmasın): eski `m.deliveredAt || m.updatedAt` zincirindeki yedek dal
 * aslında ÖLÜYDÜ — `new Date(undefined)` Invalid Date NESNESİ (truthy) döndüğü için `||` hiç düşmüyor,
 * sonuç NaN oluyor ve kayıt sessizce düşüyordu. 2026-09-19 delta turu bunu
 * `zamanDate(deliveredAt) ?? zamanDate(updatedAt)` ile "onarmıştı"; K17 ile yedek dal tümden kalktı —
 * çözülemeyen `deliveredAt` artık `tarihsiz` SAYILIR.
 *
 * PARİTE (bilinen girdide — iki tarih de okunuyor, 0 ≤ süre < sınır): `ortalamaGun.deger` (yuvarlanmamış;
 * eski `Math.round` ÇAĞIRANDA, `bicim.gunYaz` ile), `enHizliGun`, `enYavasGun` ve kova adetleri eski kodla
 * BİREBİR. Kova eşleşmesi de birebir: eski `find(b => d <= b.max)` ile `max: 1|3|7|14|∞`, tam sayı günde
 * `ust: 2|4|8|15|∞` yarı-açık `[alt, ust)` aralıklarıyla AYNI küme (test 1 bunu 0..30 gün için kilitler).
 * Süre HAM ms farkıdır (parite: eski :302 `getTime()` farkı) — `gunBasi` takvim günü DEĞİL.
 *
 * BİLİNÇLİ FARKLAR (rakamı değiştirenler — hepsi gerekçeli):
 *   B1 `updatedAt` yedeği KALKTI (K17) → `deliveredAt`i olmayan teslimat ölçümden çıkar; ort./min/maks değişir.
 *   B2 Negatif süre (`saat < 0`) artık `kapsamDisi` — eskiden `Math.round(-0,2) = -0`, `-0 >= 0` DOĞRU olduğu
 *      için 0 gün olarak ortalamaya giriyordu (CLAUDE.md: bilinmeyen 0 sayılmaz). Kapı HAM saate uygulanır.
 *      Emsal: `dagilim.ts` `ILK_KOVA_ALT = 0` — negatif değer sessizce düşmez, SAYILIR.
 *   B3 Düşen kayıtlar SAYILIYOR (`tarihsiz`, `kapsamDisi`) — sessiz kapsam dışı yok.
 *   (B4 hayalet çubuk ve B5 zamanında/geç/ölçülemedi satırı ÇAĞIRANIN diff'indedir.)
 *
 * İKİ SÖZLEŞME (para.ts): `ortalamaGun` `Tutar`-benzeri KISMİ yapıdır (toplamGun / olculen / olculemeyen);
 * türetilen `deger` ölçüm yoksa `null` — `: 0` yedeği YASAK. `tarihsiz` (süre ölçülemedi) ile `olculemedi`
 * (zamanında ölçülemedi) AYNI siparişi ikisi de sayabilir (`deliveredAt`i olmayan sipariş) → TOPLANMAZLAR,
 * ekranda AYRI cümlelerde geçerler (6a "bilinmeyen sayaçları çift sayılmaz"). `tarihsiz ∩ kapsamDisi = ∅`
 * (kapsam dışı olmak için iki tarihin de okunmuş olması gerekir).
 *
 * KAPSAM DIŞI (bilerek): durum süzgeci YOK — iptal/teslim durumu ÇAĞIRANDA süzülür (K2 ciro kuralıdır,
 * süre için değil; `dagilim.ts` "iptal süzgeci bu modülde YOK" hattı). Ekran metni / dil YOK (kova
 * etiketleri çağırandan gelir). `lojistikKpi.teslimPerformansi` (OrdersPage P576, pencere + durum
 * süzgeçli) ÇAĞRILMAZ — o sözleşme OrdersPage'indir.
 *
 * İMZA NOTU (şartnameye ADDITIVE): `teslimSureleri` iki aşırı yüklemeyle dışa açılır — `kovalar` verilen
 * çağrıda `dagitim` tipi `null` İÇERMEZ; böylece GB1 gibi kovalı tüketici ne `!` ne de ölü
 * `if (dagitim === null)` dalı yazar. Gövde tektir.
 */
import { zamanMs } from '../zaman';
import { zamanindaTeslimat } from '../siparisler/lojistikKpi';
import { kovayaYerlestir, type KovaSiniri, type DegerKovasi } from './dagilim';

/**
 * Yapısal — kanonik `Order`a bağlı DEĞİL. `deliveredAt` types.ts `Order` içinde İLAN EDİLMEMİŞ
 * (lojistikKpi.ts `PerformansSiparisi` notu bugün de geçerli: OrdersPage 385/3470 ve App.tsx 6221 bu
 * alanı YAZIYOR); opsiyonel `unknown` okunur, çağıran cast YAZMAZ.
 */
export interface TeslimSiparisi {
  createdAt?: unknown;
  deliveredAt?: unknown;
  estimatedDelivery?: unknown;
}

/** Tek ölçüm. `gun` YUVARLANMIŞ tam gün (parite: eski `Math.round`), `saat` HAM (yuvarlanmamış). */
export interface TeslimOlcumu<T> { siparis: T; gun: number; saat: number }

/** Üst eleme sınırı — her tüketici KENDİ literal sayısını ve KENDİ karşılaştırmasını korur (K20: değer değişmez). */
export interface TeslimUstSiniri {
  deger: number;
  /** `'gun'` → YUVARLANMIŞ güne, `'saat'` → HAM saate uygulanır. */
  birim: 'gun' | 'saat';
  /** `true` → sınır değeri kapsam İÇİNDE (`<=`). Varsayılan `false` → HARİÇ (`<`), `dagilim.KovaSiniri.ust` ile aynı konvansiyon. */
  dahil?: boolean;
}

/** `Tutar`-benzeri: KISMİ toplam + payda + dışarıda kalan. Türetilen `deger` ölçüm yoksa null. */
export interface OrtalamaTeslimGunu {
  /** Ortalama gün — `olculen === 0` ise `null` ('—'; rozet/çubuk ÇİZİLMEZ). YUVARLANMAZ (biçim çağıranda). */
  deger: number | null;
  /** `Tutar.toplam` muadili: ölçülen günlerin toplamı (KISMİ olabilir). */
  toplamGun: number;
  /** `Tutar.bilinen` muadili = ortalamanın PAYDASI. */
  olculen: number;
  /** `Tutar.bilinmeyen` muadili = `tarihsiz + kapsamDisi`. */
  olculemeyen: number;
}

export interface TeslimSuresiSecenegi {
  /** Verilmezse üst eleme YOK (yalnız negatif süre elenir). */
  ustSinir?: TeslimUstSiniri;
  /** Histogram sınırları (etiketler ÇAĞIRANDA — dil metni bu modüle girmez). Verilmezse `dagitim: null`. */
  kovalar?: readonly KovaSiniri[];
}

/**
 * Kovalanan küme = `olcumler` (ortalamayla AYNI örneklem). `gun` her zaman bilinen sonlu sayı olduğu için
 * `bilinmeyen` DAİMA 0; son kova `Infinity` değilse taşan ölçüm `kapsamDisi`ne düşer ve ÇAĞIRAN onu göstermek
 * zorundadır. DİKKAT: buradaki `kapsamDisi` (histogram taşması) ile üst düzey `kapsamDisi` (eleme sınırı)
 * FARKLI şeylerdir; ayrık kümelerdir, aynı cümlede birleştirilmezler.
 */
export interface TeslimDagitimi<T> {
  kovalar: DegerKovasi<TeslimOlcumu<T>>[];
  bilinmeyen: number;
  kapsamDisi: number;
}

export interface TeslimSureleriSonucu<T> {
  /** Kapsam içi ölçümler, GİRDİ SIRASINDA; `siparis` nesne KİMLİĞİNİ korur. */
  olcumler: readonly TeslimOlcumu<T>[];
  ortalamaGun: OrtalamaTeslimGunu;
  /** En kısa / en uzun ölçüm (gün) — ölçüm yoksa `null` (`Math.min(...[])` → `Infinity` tuzağı YOK). */
  enHizliGun: number | null;
  enYavasGun: number | null;
  /** `createdAt` ya da `deliveredAt` ÇÖZÜLEMEYEN sipariş — ölçüme girmez, SAYILIR. */
  tarihsiz: number;
  /** İki tarih de okundu ama süre sınır dışı (negatif, ya da `ustSinir` aşıldı) — SAYILIR. */
  kapsamDisi: number;
  /** K17 — `zamanindaTeslimat` sözleşmesi. DEĞİŞMEZ: `zamaninda + gec + olculemedi === siparisler.length`. */
  zamaninda: number;
  gec: number;
  olculemedi: number;
  /** `zamanindaTeslimat().oran` (payda `zamaninda + gec`); ölçülebilir teslimat yoksa `null`. */
  zamanindaOrani: number | null;
  /** `sec.kovalar` verilmediyse `null`. */
  dagitim: TeslimDagitimi<T> | null;
}

const SAAT_MS = 3_600_000;
const GUNUN_SAATI = 24;

/** `ustSinir` kapısı — `birim`e göre yuvarlanmış güne ya da ham saate; `dahil` false ise `<`, true ise `<=`. */
function sinirIcinde(gun: number, saat: number, sinir: TeslimUstSiniri | undefined): boolean {
  if (sinir === undefined) return true;
  const deger = sinir.birim === 'gun' ? gun : saat;
  return sinir.dahil === true ? deger <= sinir.deger : deger < sinir.deger;
}

export function teslimSureleri<T extends TeslimSiparisi>(
  siparisler: readonly T[],
  sec: TeslimSuresiSecenegi & { kovalar: readonly KovaSiniri[] },
): TeslimSureleriSonucu<T> & { dagitim: TeslimDagitimi<T> };
export function teslimSureleri<T extends TeslimSiparisi>(
  siparisler: readonly T[],
  sec?: TeslimSuresiSecenegi,
): TeslimSureleriSonucu<T>;
/**
 * Teslim edilmiş siparişlerin `createdAt → deliveredAt` süresi (gün/saat), ortalaması, uçları, isteğe bağlı
 * histogramı ve K17 zamanında/geç/ölçülemedi sayaçları. Girdi MUTASYONA UĞRAMAZ.
 *
 * Durum süzgeci YOK: çağıran ne verirse o ölçülür (GB1 yalnız `status === 'Delivered'` verir).
 */
export function teslimSureleri<T extends TeslimSiparisi>(
  siparisler: readonly T[],
  sec?: TeslimSuresiSecenegi,
): TeslimSureleriSonucu<T> {
  const sinir = sec?.ustSinir;
  // `!(x >= 0)` NaN'ı da yakalar (dagilim.ts sınır denetimiyle aynı biçim). Geçersiz sınır programcı
  // hatasıdır; sessizce "her kayıt kapsam dışı" ÜRETİLMEZ. `Infinity` geçerlidir (= sınır yok).
  if (sinir !== undefined && !(sinir.deger >= 0)) {
    throw new Error(
      `teslimSureleri: üst sınır 0 ya da pozitif bir sayı olmalı — verilen ${String(sinir.deger)} (${sinir.birim}).`,
    );
  }

  const olcumler: TeslimOlcumu<T>[] = [];
  let tarihsiz = 0;
  let kapsamDisi = 0;
  let toplamGun = 0;
  let enHizliGun: number | null = null;
  let enYavasGun: number | null = null;

  for (const s of siparisler) {
    const olusturma = zamanMs(s.createdAt);
    // K17 kullanıcı 2026-09-19: "Önerin ok. Siparişin kendi teslim tarihini baz al. 2. soru kabul."
    // → YALNIZ `deliveredAt`; `updatedAt` / `completedAt` yedeği YOK. Çözülemeyen kayıt ölçüme
    // girmez, `tarihsiz` SAYILIR (ekranda "N siparişin tarihi çözülemedi" notu).
    const teslim = zamanMs(s.deliveredAt);
    if (olusturma === null || teslim === null) { tarihsiz++; continue; }

    const saat = (teslim - olusturma) / SAAT_MS;
    // Kapı HAM saate: `Math.round(-0.2) === -0` ve `-0 >= 0` DOĞRU — eski kod önce yuvarlayıp sonra
    // kapıya baktığı için negatif süreyi "0 gün" diye ortalamaya sokuyordu (B2). Negatif süre veri
    // hatasıdır: ölçüm DEĞİL, sessizce de düşmez — SAYILIR.
    if (saat < 0) { kapsamDisi++; continue; }

    const gun = Math.round(saat / GUNUN_SAATI);           // parite: eski :302 `Math.round`
    if (!sinirIcinde(gun, saat, sinir)) { kapsamDisi++; continue; }

    olcumler.push({ siparis: s, gun, saat });
    toplamGun += gun;
    // `Math.min(...[])` → `Infinity` tuzağı yok: uçlar ilk ölçümde kurulur, ölçüm yoksa `null` kalır.
    if (enHizliGun === null || gun < enHizliGun) enHizliGun = gun;
    if (enYavasGun === null || gun > enYavasGun) enYavasGun = gun;
  }

  const olculen = olcumler.length;
  // "Zamanında" kuralı burada YAZILMAZ — lojistikKpi'nin takvim günü sözleşmesi (K17).
  const z = zamanindaTeslimat(siparisler);
  const kovalar = sec?.kovalar;
  const dagitim = kovalar === undefined ? null : kovayaYerlestir(olcumler, m => m.gun, kovalar);

  return {
    olcumler,
    ortalamaGun: {
      // Türetilen sayı: tek ölçüm bile yoksa BİLİNMİYOR (`: 0` yedeği YASAK — "0 gün" sahte kesinlik).
      deger: olculen > 0 ? toplamGun / olculen : null,
      toplamGun,
      olculen,
      olculemeyen: tarihsiz + kapsamDisi,
    },
    enHizliGun,
    enYavasGun,
    tarihsiz,
    kapsamDisi,
    zamaninda: z.zamaninda,
    gec: z.olculen - z.zamaninda,
    olculemedi: z.olculemeyen,
    zamanindaOrani: z.oran,
    dagitim,
  };
}
