/**
 * finansKpi.ts — Pano (DashboardPage) finansal KPI ve uyarı şeritlerinin TEK KAYNAĞI.
 * Faz 3 5/n, grup "finansKpi", 2026-09-19. Test: finansKpi.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR — beş panel aynı arızayı tekrarlıyordu: BİLİNMEYEN bir sayı sessizce 0 sayılıp
 * ekrana KESİN bir rakam ya da KIRMIZI bir uyarı olarak basılıyordu (DashboardPage satırları):
 *   · 284       `inventory.filter(i => (i.stockLevel ?? 0) <= 0)` → stok seviyesi okunamayan
 *               ürün "stokta kalmadı" alarmı üretiyordu.
 *   · 615, 617  `(Number(i.stock) || 0) > 0 && … <= (Number(i.minStock) || 5)` → `stock` diye bir
 *               alan InventoryItem'da YOK (kanonik ad `stockLevel`; bkz. types.ts 39) — bu dal
 *               hiç çalışmıyordu; ayrıca `|| 5` eşiği uyduruyor, `|| 0` meşru 0 eşiği eziyordu.
 *   · 621-622   `${top.stock ?? 0} adet kaldı` → bilinmeyen adet "0 adet" diye yazılıyordu.
 *   · 632       `unpaidOrders.reduce((s, o) => s + (o.totalPrice ?? 0), 0)` → tutarsız sipariş ₺0.
 *   · 669-682   bu ay / geçen ay cirosu `?? 0` ile toplanıp aradaki YÜZDE kesin gibi basılıyordu.
 *   · 938       AOV `sum(totalPrice || 0) / filteredOrders.length`: tutarı okunamayan sipariş
 *               PAYDAYA girip PAYA 0 katıyordu; boş listede de "₺0" yazıyordu.
 *   · 941, 944  teslimat / dönüşüm oranı liste boşken `0` → "%0 teslimat" sahte kesinliği.
 *   · 947-951   `custMap[o.customerName]`: adı olmayan siparişler "undefined" anahtarında
 *               birikip sahte "tekrar eden alıcı" üretiyordu.
 *   · 1024      `(i.stockLevel ?? 0) <= (i.lowStockThreshold ?? i.minStock ?? 5)` → aynı sahte
 *               sıfır + uydurma eşik, bu kez KRİTİK STOK UYARISI olarak.
 *   · 1071-1073 günlük nakit: ciro / tahsilat / alacak `(o.totalPrice || 0)` ile toplanıyordu.
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme" + para.ts iki sözleşme):
 *   EKRAN toplamı kısmi olabilir — `ekranTutari` + yanında "N kayıt tutarsız" notu;
 *   TÜRETİLEN sayı (ortalama / oran / yüzde) bir girdi bile bilinmiyorsa ÜRETİLMEZ ('—');
 *   değeri BİLİNMEYEN bir KPI için uyarı üretilmez — "veri yok" diye listelenir.
 *
 * PARİTE: bütün girdiler biliniyorken her fonksiyon eski kodun rakamını BİREBİR verir
 * (finansKpi.test.ts'te her başlık altında bir "SAYFA PARİTESİ" vakası var).
 *
 * BİLİNÇLİ FARKLAR (bağlama ajanı ve kullanıcı için — hepsi testli):
 *   1. Kritik stok artık `stockLevel` (kanonik alan) üzerinden okunur; `stock` yalnız ESKİ
 *      kayıtlar için yedek. Phase 90'ın 1. içgörüsü bu yüzden bugüne dek HİÇ çalışmıyordu;
 *      bağlandığında ÇALIŞMAYA BAŞLAR (davranış değişikliği — açık sorulara yazıldı).
 *   2. Eşiği bilinmeyen ürün için "kritik stok" kararı verilmez (`?? 5` kaldırıldı); bu ürünler
 *      `esigiBilinmeyen` ile ayrıca sayılır. Gerçekten 0'a düşmüş ürün eşik bilinmese de tükenmiştir.
 *   3. Durumu / tarihi / adı okunamayan kayıt oranın PAYDASINA girmez, ayrı sayaçta raporlanır.
 *   4. Aday gecikmesi: tarihi hiç olmayan aday "7+ gündür güncellenmedi" DEMEZ (`tarihsiz` sayacı).
 *      Eski kodda aynı sayfada iki farklı cevap vardı: Phase 90 (680) tarihsizi gecikmiş sayıyor,
 *      Phase 528 (271) hiç saymıyordu.
 *   5. "Aktif aday" tanımı üç kapanış durumunu da dışlar ('Closed', 'Closed Won', 'Closed Lost');
 *      Phase 528 yalnız 'Closed'ı dışlıyordu, kazanılmış müşteriyi "güncellenmemiş aday" sanıyordu.
 *   6. Sipariş tarihi tek sırayla çözülür: `createdAt → syncedAt → orderDate`. Phase 90 (688)
 *      ay kovasını `syncedAt` önceliğiyle kuruyordu; aynı sipariş o panelde başka aya düşebiliyordu.
 *
 * TİPLER YAPISAL (siparis.ts ile aynı gerekçe): kanonik `Order`/`Lead`/`InventoryItem` şart
 * koşulmaz, her fonksiyon GERÇEKTEN OKUDUĞU alanları ister — aynı hesabın RaporlarPage /
 * GenelBloklar2 kopyaları da bu modüle bağlanabilsin diye.
 */
import { bilinenSayi, toplaBilinen, ekranTutari, tamTutar, sayiSirala, tahsilatOrani, type Tutar } from '../para';
import { odemeTakipli, siparisTutari } from '../siparis';
import { zamanMs, ayAnahtari, gunAnahtari } from '../zaman';

// ── Girdi şekilleri ──────────────────────────────────────────────────────────

/** Panoda okunan sipariş alanları (Order ve Mikro'dan eşlenen türevleri yapısal olarak uyar). */
export interface KpiSiparis {
  totalPrice?: unknown;
  totalAmount?: unknown;
  status?: unknown;
  paid?: unknown;
  source?: string;
  customerName?: unknown;
  createdAt?: unknown;
  syncedAt?: unknown;
  orderDate?: unknown;
}

/** Panoda okunan müşteri adayı alanları. */
export interface KpiAday {
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Panoda okunan envanter alanları. `stock` yalnız eski kayıtlar için yedektir (bkz. fark 1). */
export interface KpiStokKalemi {
  stockLevel?: unknown;
  stock?: unknown;
  lowStockThreshold?: unknown;
  minStock?: unknown;
}

const sayi = (x: unknown): number => (bilinenSayi(x) ? Number(x) : NaN);

/**
 * Kaydın zamanı — TEK sıra: `createdAt → syncedAt → orderDate`. Çözülemezse null
 * (ASLA "şimdi"ye düşmez; bkz. zaman.ts). Eski panellerde üç farklı sıra vardı.
 */
function kayitZamani(o: KpiSiparis): number | null {
  return zamanMs(o.createdAt) ?? zamanMs(o.syncedAt) ?? zamanMs(o.orderDate);
}

/** Yüzde (yuvarlanmış); payda 0 ya da bilinmiyorsa null — "%0" sahte kesinliktir. */
export function yuzdeOrani(pay: number, payda: number): number | null {
  if (!Number.isFinite(pay) || !Number.isFinite(payda) || payda <= 0) return null;
  return Math.round((pay / payda) * 100);
}

// ── Stok durumu (Phase 528 · 284, Phase 90 · 615-620, Phase 124 · 1024) ──────

/** Ürünün stok seviyesi: kanonik `stockLevel`, eski kayıtlarda `stock`. Bilinmiyorsa NaN. */
export function stokSeviyesi(i: KpiStokKalemi): number {
  const s = sayi(i.stockLevel);
  return Number.isFinite(s) ? s : sayi(i.stock);
}

/** Kritik stok eşiği: `lowStockThreshold`, yoksa `minStock`. Bilinmiyorsa NaN (uydurma 5 YOK). */
export function stokEsigi(i: KpiStokKalemi): number {
  const e = sayi(i.lowStockThreshold);
  return Number.isFinite(e) ? e : sayi(i.minStock);
}

export interface StokDurumu<T> {
  /** Seviyesi BİLİNEN ve ≤ 0 olan ürünler ("stokta kalmadı" — eşik bilinmese de kesin). */
  tukenen: T[];
  /** Seviyesi ve eşiği bilinen, 0'ın üstünde ama eşiğin altındaki ürünler. */
  kritik: T[];
  /** Seviyesi ve eşiği bilinen, seviye ≤ eşik olan ürünler (tükenenler dahil — Phase 124 sayacı). */
  esikAltinda: T[];
  /** `kritik` içinde stoku en az olan ürün (içgörü metni için); yoksa null. */
  enDusukKritik: T | null;
  /** Stok seviyesi okunamayan ürün sayısı — "0 stok" diye raporlanmaz, sayılır. */
  seviyesiBilinmeyen: number;
  /** Seviyesi bilinen ama eşiği bilinmeyen ürün sayısı — kritik/normal kararı verilemez. */
  esigiBilinmeyen: number;
}

/** Stok uyarılarının tek hesabı. Girdi dizisi MUTASYONA uğramaz (sıralama kopya üzerinde). */
export function stokDurumu<T extends KpiStokKalemi>(envanter: readonly T[]): StokDurumu<T> {
  const tukenen: T[] = [], kritik: T[] = [], esikAltinda: T[] = [];
  let seviyesiBilinmeyen = 0, esigiBilinmeyen = 0;
  for (const i of envanter) {
    const seviye = stokSeviyesi(i);
    if (!Number.isFinite(seviye)) { seviyesiBilinmeyen++; continue; }
    if (seviye <= 0) { tukenen.push(i); }
    const esik = stokEsigi(i);
    if (!Number.isFinite(esik)) { esigiBilinmeyen++; continue; }
    if (seviye <= esik) {
      esikAltinda.push(i);
      if (seviye > 0) kritik.push(i);
    }
  }
  const enDusukKritik = [...kritik].sort((a, b) => sayiSirala(stokSeviyesi(a), stokSeviyesi(b)))[0] ?? null;
  return { tukenen, kritik, esikAltinda, enDusukKritik, seviyesiBilinmeyen, esigiBilinmeyen };
}

// ── Ödenmemiş / gecikmiş siparişler (Phase 528 · 291, Phase 90 · 673, Phase 124 · 1029) ──

export interface OdenmemisSonuc {
  /** Ödemesi Cetpa'da izlenen, iptal olmayan, ödenmemiş sipariş SAYISI. */
  sayi: number;
  /** Bekleyen tutar — `bilinmeyen > 0` ise sayfa "N kayıt tutarsız" notu koyar. */
  tutar: Tutar;
  /** EKRAN değeri: kısmi toplam; hiç bilinen tutar yoksa NaN → fmtKpi '—'. */
  ekran: number;
}

/**
 * Açık alacak kapısı — TEK TANIM. `odenmemisSiparisler` ve `nakitPozisyonu` aynı kümeyi
 * seçmek zorunda: ikisi ayrı ayrı süzerse "kaç kayıt tutarsız" sayacı iki kümeyi
 * tekilleştiremez (Faz 3 5/n hakem bulgusu).
 */
function acikAlacakMi(o: KpiSiparis): boolean {
  return odemeTakipli(o) && o.paid !== true && o.status !== 'Cancelled';
}

/**
 * Ödenmemiş siparişler. Mikro kaynaklı kayıtların `paid` alanına BAKILMAZ (tahsilat gerçeği
 * Mikro cari hesapta — `odemeTakipli`). `durum` verilirse yalnız o durumdakiler (Phase 528
 * "teslim edilmiş ama ödenmemiş" şeridi).
 */
export function odenmemisSiparisler(
  siparisler: readonly KpiSiparis[],
  secenek: { durum?: string } = {},
): OdenmemisSonuc {
  const liste = siparisler.filter(o =>
    acikAlacakMi(o) && (secenek.durum === undefined || o.status === secenek.durum));
  const tutar = toplaBilinen(liste, siparisTutari);
  return { sayi: liste.length, tutar, ekran: ekranTutari(tutar) };
}

export interface GecikmeSonuc {
  /** Tarihi BİLİNEN ve eşikten eski kayıt sayısı. */
  sayi: number;
  /** Tarihi hiç çözülemeyen kayıt sayısı — "N gündür gecikmiş" diye raporlanmaz, sayılır. */
  tarihsiz: number;
}

/** Ödemesi `gun` günden fazla gecikmiş siparişler (Phase 124). Tarihsiz kayıt gecikmiş SAYILMAZ. */
export function gecikmisOdemeler(
  siparisler: readonly KpiSiparis[],
  { simdi, gun }: { simdi: number; gun: number },
): GecikmeSonuc {
  let sayi = 0, tarihsiz = 0;
  for (const o of siparisler) {
    // Satır içi kopya değil `acikAlacakMi` (2026-09-19): "TEK TANIM" yorumu ancak üç çağıran da
    // aynı kapıyı kullanınca doğrudur; kopya, süzgeç değişince sessizce ayrışırdı.
    if (!acikAlacakMi(o)) continue;
    const ms = kayitZamani(o);
    if (ms === null) { tarihsiz++; continue; }
    if (simdi - ms > gun * 86_400_000) sayi++;
  }
  return { sayi, tarihsiz };
}

/** `gun` günden uzun süredir 'Pending' bekleyen siparişler (Phase 528). Tarihsizler ayrı sayılır. */
export function bekleyenSiparisler(
  siparisler: readonly KpiSiparis[],
  { simdi, gun }: { simdi: number; gun: number },
): GecikmeSonuc {
  let sayi = 0, tarihsiz = 0;
  for (const o of siparisler) {
    if (o.status !== 'Pending') continue;
    const ms = kayitZamani(o);
    if (ms === null) { tarihsiz++; continue; }
    if (simdi - ms > gun * 86_400_000) sayi++;
  }
  return { sayi, tarihsiz };
}

// ── Müşteri adayları (Phase 528 · 271, Phase 90 · 680) ───────────────────────

const KAPANIS_DURUMLARI: readonly string[] = ['Closed', 'Closed Won', 'Closed Lost'];

/** Aday hâlâ hatta mı? Üç kapanış durumunun HİÇBİRİ aktif değildir (bkz. bilinçli fark 5). */
export function aktifAdayMi(a: KpiAday): boolean {
  return !(typeof a.status === 'string' && KAPANIS_DURUMLARI.includes(a.status));
}

/** `gun` günden uzun süredir güncellenmemiş AKTİF adaylar. Tarihi hiç olmayanlar ayrı sayılır. */
export function gecikmisAdaylar(
  adaylar: readonly KpiAday[],
  { simdi, gun }: { simdi: number; gun: number },
): GecikmeSonuc {
  let sayi = 0, tarihsiz = 0;
  for (const a of adaylar) {
    if (!aktifAdayMi(a)) continue;
    const ms = zamanMs(a.updatedAt) ?? zamanMs(a.createdAt);
    if (ms === null) { tarihsiz++; continue; }
    if (simdi - ms > gun * 86_400_000) sayi++;
  }
  return { sayi, tarihsiz };
}

// ── Aylık ciro değişimi (Phase 90 · 688-696) ─────────────────────────────────

export interface AylikDegisim {
  /** Bu ayın tutarı (EKRAN sözleşmesi: kısmi olabilir, sayaçlar yanında). */
  buAy: Tutar;
  /** Geçen ayın tutarı. */
  gecenAy: Tutar;
  /** TÜRETME: iki ayda da tek kayıt bile eksikse null; geçen ay ≤ 0 ise de null. */
  yuzde: number | null;
  yon: 'artis' | 'azalis' | null;
  /** Eski eşik: bu ay > geçen ay × 1,1. Türetilemiyorsa false (içgörü BASILMAZ). */
  belirginArtis: boolean;
}

/**
 * Bu ay / geçen ay ciro karşılaştırması. Tarihi çözülemeyen sipariş HİÇBİR aya yazılmaz
 * (o yüzden "bilinmeyen" sayacına da girmez — o kayıt bu dönemin kaydı olmayabilir).
 */
export function aylikCiroDegisimi(siparisler: readonly KpiSiparis[], simdi: number): AylikDegisim {
  const ref = new Date(simdi);
  const buAyKey = ayAnahtari(ref);
  const gecenAyKey = ayAnahtari(new Date(ref.getFullYear(), ref.getMonth() - 1, 1));
  const ayinkiler = (key: string | null) =>
    siparisler.filter(o => { const k = ayAnahtari(kayitZamani(o)); return k !== null && k === key; });

  const buAy = toplaBilinen(ayinkiler(buAyKey), siparisTutari);
  const gecenAy = toplaBilinen(ayinkiler(gecenAyKey), siparisTutari);
  // TÜRETME kapısı: kısmi bir aydan yüzde çıkarılmaz (para.ts tamTutar).
  const a = tamTutar(buAy), b = tamTutar(gecenAy);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) {
    return { buAy, gecenAy, yuzde: null, yon: null, belirginArtis: false };
  }
  return {
    buAy, gecenAy,
    yuzde: Math.round(((a - b) / b) * 100),
    yon: a >= b ? 'artis' : 'azalis',
    belirginArtis: a > b * 1.1,
  };
}

// ── Phase 42 finansal KPI şeridi ─────────────────────────────────────────────

export interface AovSonuc {
  /** TÜRETME: bilinen tutarların ortalaması; hiç bilinen sipariş yoksa NaN → '—'. */
  deger: number;
  /** Ortalamaya giren (tutarı bilinen) sipariş sayısı. */
  sayilan: number;
  /** Tutarı okunamadığı için ortalamaya GİRMEYEN sipariş sayısı (sayfa notu). */
  bilinmeyen: number;
}

/**
 * Ortalama sipariş tutarı (AOV) — TÜRETME. Tutarı bilinmeyen sipariş ne paya ne paydaya
 * girer, SAYILIR: eski `sum(totalPrice || 0) / length` her tutarsız kaydı ₺0'lık bir
 * sipariş sanıp ortalamayı sistematik olarak aşağı çekiyordu.
 */
export function ortalamaSiparisTutari(siparisler: readonly KpiSiparis[]): AovSonuc {
  const t = toplaBilinen(siparisler, siparisTutari);
  return {
    deger: t.bilinen > 0 ? t.toplam / t.bilinen : NaN,
    sayilan: t.bilinen,
    bilinmeyen: t.bilinmeyen,
  };
}

export interface OranSonuc {
  /** Yuvarlanmış yüzde; payda 0 ise null ('—', ASLA "%0"). */
  oran: number | null;
  pay: number;
  payda: number;
  /** Durumu okunamadığı için paydaya girmeyen kayıt sayısı. */
  durumsuz: number;
}

/** Kart alt etiketi "3 / 4" diye yazdığı için pay/payda okunur adlarla da döner. */
export interface TeslimatSonuc extends OranSonuc { teslim: number; toplam: number }

/** Teslimat oranı (Phase 42). Durumu okunamayan sipariş paydaya girmez, sayılır. */
export function teslimatOrani(siparisler: readonly KpiSiparis[]): TeslimatSonuc {
  let pay = 0, payda = 0, durumsuz = 0;
  for (const o of siparisler) {
    if (typeof o.status !== 'string' || o.status === '') { durumsuz++; continue; }
    payda++;
    if (o.status === 'Delivered') pay++;
  }
  return { oran: yuzdeOrani(pay, payda), pay, payda, durumsuz, teslim: pay, toplam: payda };
}

/** Sayılan alanlar okunur kalsın diye teslimat/dönüşüm aynı şekli döner (`pay` = kazanılan). */
export interface DonusumSonuc extends OranSonuc { kazanilan: number; toplam: number }

/** Aday dönüşüm oranı (Phase 42). 'Closed' ve 'Closed Won' kazanılmış, 'Closed Lost' DEĞİL. */
export function adayDonusumOrani(adaylar: readonly KpiAday[]): DonusumSonuc {
  let pay = 0, payda = 0, durumsuz = 0;
  for (const a of adaylar) {
    if (typeof a.status !== 'string' || a.status === '') { durumsuz++; continue; }
    payda++;
    if (a.status === 'Closed' || a.status === 'Closed Won') pay++;
  }
  return { oran: yuzdeOrani(pay, payda), pay, payda, durumsuz, kazanilan: pay, toplam: payda };
}

/**
 * Aday HUNİSİ'nin kazanma oranı (DashboardPage "Lead Pipeline Funnel" rozeti).
 * Payda AKTİF aşamaların toplamı + kazanılan; hiç aday yoksa `null` (rozet '—' ya da çizilmez).
 *
 * Sayfadaki hâli `totalActive > 0 ? ((counts[5] / (totalActive + counts[5])) * 100).toFixed(0) : '0'`
 * idi (2026-09-19 delta bulgusu): kapı YANLIŞ paydaya bakıyordu. Hepsi kapanmış bir huni
 * (aktif 0, 'Closed Won' 4) gerçekte %100 iken ekrana "Win Rate: 0%" basıyor, hiç aday yokken de
 * '—' yerine '0%' yazıyordu. Kapanış ölçüsünün `||` / `??` regex'i bu `: '0'` üçlü-yedeğini
 * görmüyordu — sahte kesinlik üçlü ifadeyle de yazılabilir.
 *
 * DİKKAT — `adayDonusumOrani` ile AYNI ŞEY DEĞİL: orada 'Closed' de kazanılmış sayılır ve
 * 'Closed Lost' paydadadır; hunide o iki durum hiç görünmez. Aynı sayfada iki farklı "kazanma
 * oranı" çıkıyor (2 kazanılan + 8 kaybedilen + 0 aktif → kart %20, huni %100). Tanım kararı
 * kullanıcıya ait (Açık İşler); bu fonksiyon yalnız HUNİNİN kendi tanımını testli kılar.
 */
export function huniKazanmaOrani(aktifAsamaSayilari: readonly number[], kazanilan: number): number | null {
  const aktif = aktifAsamaSayilari.reduce((a, b) => a + b, 0);
  return yuzdeOrani(kazanilan, aktif + kazanilan);
}

export interface TekrarAliciSonuc {
  /** Birden fazla siparişi olan müşteri sayısı. */
  tekrarEden: number;
  /** Adı bilinen benzersiz müşteri sayısı. */
  benzersiz: number;
  /** Müşteri adı okunamayan sipariş sayısı — TEK bir "undefined" müşteriye yığılmazlar. */
  isimsiz: number;
}

/**
 * Tekrar eden alıcılar (Phase 42). Adı olmayan siparişler eskiden `custMap["undefined"]`
 * kovasında birikip iki adsız kayıttan sahte bir "sadık müşteri" üretiyordu.
 */
export function tekrarEdenAlicilar(siparisler: readonly KpiSiparis[]): TekrarAliciSonuc {
  const sayac = new Map<string, number>();
  let isimsiz = 0;
  for (const o of siparisler) {
    const ad = typeof o.customerName === 'string' ? o.customerName.trim() : '';
    if (!ad) { isimsiz++; continue; }
    sayac.set(ad, (sayac.get(ad) ?? 0) + 1);
  }
  let tekrarEden = 0;
  for (const n of sayac.values()) if (n > 1) tekrarEden++;
  return { tekrarEden, benzersiz: sayac.size, isimsiz };
}

export interface FinansKpiGirdisi {
  /** AOV için: tarih aralığına göre SÜZÜLMÜŞ siparişler (sayfadaki `filteredOrders`). */
  filtreliSiparisler: readonly KpiSiparis[];
  /** Teslimat oranı / tekrar eden alıcı / tahsilat için: tüm siparişler (`orders`). */
  siparisler: readonly KpiSiparis[];
  adaylar: readonly KpiAday[];
}

export interface FinansKpi {
  aov: AovSonuc;
  teslimat: OranSonuc;
  donusum: DonusumSonuc;
  tekrarAlici: TekrarAliciSonuc;
  /** para.ts `tahsilatOrani`: yalnız Cetpa'da izlenen, iptal olmayan siparişler; izlenen ciro 0 → null. */
  tahsilat: ReturnType<typeof tahsilatOrani>;
}

/** Phase 42 şeridinin tek çağrısı. */
export function finansKpilari(g: FinansKpiGirdisi): FinansKpi {
  return {
    aov: ortalamaSiparisTutari(g.filtreliSiparisler),
    teslimat: teslimatOrani(g.siparisler),
    donusum: adayDonusumOrani(g.adaylar),
    tekrarAlici: tekrarEdenAlicilar(g.siparisler),
    tahsilat: tahsilatOrani(g.siparisler.map(o => ({
      totalPrice: siparisTutari(o),                                   // totalPrice ?? totalAmount, bilinmiyorsa NaN
      paid: o.paid === true,
      status: typeof o.status === 'string' ? o.status : undefined,
      source: o.source,
    }))),
  };
}

// ── Phase 130 günlük nakit pozisyonu ─────────────────────────────────────────

export interface NakitPozisyonu {
  /** Seçili günün cirosu (iptaller hariç). */
  bugunCiro: Tutar;
  /** Seçili günün tahsil edilmiş tutarı. */
  bugunTahsil: Tutar;
  /** Ödemesi Cetpa'da izlenen tüm açık alacak. */
  toplamAlacak: Tutar;
  /**
   * Kartın "N kaydın tutarı okunamadı" notu için BENZERSİZ tutarsız kayıt sayısı.
   * `bugunCiro.bilinmeyen + toplamAlacak.bilinmeyen` TOPLAMA — iki küme kesişir: bugün açılan
   * sipariş çoğu zaman aynı gün ödenmemiştir, tek kayıt "2 kayıt" diye raporlanır.
   * Tekilleştirme NESNE KİMLİĞİYLE: alan bazlı eşitlik, birebir aynı görünen iki gerçek
   * siparişi tek kayıt sanıp sayacı eksiltirdi.
   */
  tutarsizKayit: number;
  /** Kartlara basılacak EKRAN değerleri (kısmi toplam; hiç bilinen yoksa NaN → '—'). */
  ekran: { bugunCiro: number; bugunTahsil: number; toplamAlacak: number };
}

/**
 * Günlük nakit pozisyonu (Phase 130). `gun` YEREL 'YYYY-MM-DD' anahtarıdır (`bugunAnahtari`) —
 * `toISOString().slice(0,10)` TR'de 00:00-03:00 arası DÜNÜ verir.
 */
export function nakitPozisyonu(
  siparisler: readonly KpiSiparis[],
  { gun }: { gun: string },
): NakitPozisyonu {
  const gununkiler = siparisler.filter(o =>
    gunAnahtari(kayitZamani(o)) === gun && o.status !== 'Cancelled');
  const bugunCiro = toplaBilinen(gununkiler, siparisTutari);
  const bugunTahsil = toplaBilinen(gununkiler.filter(o => o.paid === true), siparisTutari);
  const acikAlacaklar = siparisler.filter(acikAlacakMi);
  const toplamAlacak = toplaBilinen(acikAlacaklar, siparisTutari);
  // Karta basılan sayaç: iki kümenin BİRLEŞİMİ üzerinde tek sayım (bugunTahsil ⊆ gununkiler).
  const tutarsiz = new Set<KpiSiparis>();
  for (const o of [...gununkiler, ...acikAlacaklar]) {
    if (!Number.isFinite(siparisTutari(o))) tutarsiz.add(o);
  }
  return {
    bugunCiro, bugunTahsil, toplamAlacak, tutarsizKayit: tutarsiz.size,
    ekran: {
      bugunCiro: ekranTutari(bugunCiro),
      bugunTahsil: ekranTutari(bugunTahsil),
      toplamAlacak: ekranTutari(toplamAlacak),
    },
  };
}

// ── Phase 124 eşik uyarıları ─────────────────────────────────────────────────

export type UyariSeviyesi = 'uyari' | 'kritik';

export interface EsikKurali {
  /** KPI anahtarı (`kpiler` nesnesindeki alan adı) — sayfa metni bu id ile eşleşir. */
  id: string;
  esik: number;
  /** 'ustunde': değer eşiği AŞINCA uyarır (sayaçlar); 'altinda': eşiğin ALTINA düşünce (oranlar). */
  yon: 'altinda' | 'ustunde';
  seviye: UyariSeviyesi;
}

export interface EsikUyarisi { id: string; seviye: UyariSeviyesi; deger: number; esik: number; yon: 'altinda' | 'ustunde' }

export interface EsikSonucu {
  uyarilar: EsikUyarisi[];
  /** Değeri BİLİNMEYEN KPI'lar — alarm çalınmaz, "veri yok" diye listelenir. */
  veriYok: string[];
}

/**
 * Eşik uyarıları. Değeri bilinmeyen (null / undefined / NaN / anahtar yok) bir KPI için uyarı
 * ÜRETİLMEZ: `?? 0` ile bilinmeyeni sıfıra çekmek "0 < %80 → KRİTİK" gibi sahte alarmlar
 * üretiyordu. O KPI `veriYok` listesine girer ve sayfa "veri yok" rozeti basar.
 */
export function esikUyarilari(
  kpiler: Readonly<Record<string, unknown>>,
  kurallar: readonly EsikKurali[],
): EsikSonucu {
  const uyarilar: EsikUyarisi[] = [];
  const veriYok: string[] = [];
  for (const k of kurallar) {
    const deger = sayi(kpiler[k.id]);
    if (!Number.isFinite(deger)) { veriYok.push(k.id); continue; }
    const tetikledi = k.yon === 'ustunde' ? deger > k.esik : deger < k.esik;
    if (tetikledi) uyarilar.push({ id: k.id, seviye: k.seviye, deger, esik: k.esik, yon: k.yon });
  }
  return { uyarilar, veriYok };
}
