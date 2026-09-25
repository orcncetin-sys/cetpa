/**
 * stokSevkiyat.ts — Pano (DashboardPage) stok + sevkiyat panellerinin HESAP katmanı
 * (Faz 3 5/n, 2026-09-19). Test: stokSevkiyat.test.ts (ÖNCE yazıldı).
 *
 * ## NEDEN VAR — sahte kesinlik siteleri (src/pages/DashboardPage.tsx, 2026-09-19 ölçümü)
 *
 *   • 1707 Phase 24 ajanda: `(i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)` — stoğu BİLİNMEYEN
 *     kalem 0 sayılıp "Düşük stok: KUM" uyarısı üretiyor; eşiği olmayan kalem uydurma 5 ile
 *     kıyaslanıyor. İkisi de veri değil, varsayım.
 *   • 1727 `${i.stockLevel ?? 0} / ${i.lowStockThreshold ?? 5}` — ekranda "0 / 5"; kullanıcı bunu
 *     "stok bitti" diye okur, oysa stok bilinmiyordur.
 *   • 1848 Phase 47: `itemCostTRY(i, rates) * (i.stockLevel ?? 0)` — `itemCostTRY` çevrilemeyen
 *     kaleme 0 döndüğü için (bkz. utils/cost.ts) maliyeti bilinmeyen kalem ₺0 değerli sayılıyor.
 *   • 1849 `(i.prices?.['Retail'] ?? i.price ?? 0) * (i.stockLevel ?? 0)` — fiyatı bilinmeyen ₺0.
 *   • 1850 `margin = retailValue > 0 ? Math.round(((retailValue - costValue) / retailValue) * 100) : 0`
 *     — marj TÜRETİLEN sayıdır: girdilerin biri bile eksikken "%18" basmak, boş envanterde "%0"
 *     yazıp rozeti kırmızıya boyamak uydurmadır.
 *   • 1851 `totalUnits = Σ (i.stockLevel ?? 0)` — bilinmeyen adet 0.
 *   • 1913/1914 "En Çok Satan Ürünler": `count += li.quantity || 1` (adedi bilinmeyen satır 1 ADET
 *     sayılıyor!) ve `revenue += (li.price || 0) * (li.quantity || 1)`.
 *   • 2049/2127 (hakem turu, 2026-09-19) aynı panelin ÇUBUĞU: ölçek KISMİ tepeden alınıyor
 *     (`p.ciro.bilinen > 0 && p.ciro.toplam > m`) ve çubuk KISMİ satır cirosundan çiziliyordu
 *     (`oranYuzde(ekranTutari(p.ciro), maxRevTop)`) — fiyatsız satırı olan ürün olduğundan kısa
 *     görünüp yanlış sıralama izlenimi veriyordu. Oysa aynı sayfadaki `musteriAnaliz` panelleri
 *     tam tersini yapıyordu: bir sayfada İKİ ÇELİŞEN çubuk kuralı. Kural artık `./cubuk`ta tek
 *     kaynak, `barOrani` alanı buradan çıkar (sayfada hesap kalmadı → testi de var).
 *   • 1424 Phase 43 durum çubuğu: yalnız 5 bilinen durum sayılıyor; `status` eksik/tanınmayan
 *     sipariş sessizce düşüyor, çubuk %100'e tamamlanmıyor, kullanıcı eksiği göremiyor.
 *   • 2185 Phase 73 ısı haritası: `busiest = counts.indexOf(Math.max(...counts))` — TÜM siparişlerin
 *     tarihi okunamazsa dizi sıfırdır, `indexOf(0)` 0 döner ve rozet "En yoğun: Paz" der.
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur — toplama
 * girmez, SAYILIR (`Tutar.bilinmeyen`), ekranda '—' ya da "N kayıt tutarsız" notu olur. Türetilen
 * sayı (marj, oran, "en yoğun gün" rozeti) tek girdi bile eksikse HESAPLANMAZ (null → '—', çubuk
 * çizilmez). Sayaç başlatmaları (`sayilar[k] = 0`) meşrudur: orada 0 "hiç yok" demektir.
 *
 * ## SAYFA PARİTESİ
 * Girdiler biliniyorsa sayılar eskiyle BİREBİR aynı: stok değeri = Σ birim × stockLevel; adet =
 * Σ stockLevel; marj = `Math.round(((satış − maliyet) / satış) × 100)`; ürün cirosu = Σ fiyat × adet;
 * durum sayısı = `orders.filter(o => o.status === k).length`; ısı haritası kovası = `date.getDay()`
 * (0 = Pazar), beraberlikte İLK gün (eski `indexOf` davranışı); sevkiyat listesi `createdAt` azalan.
 * Sayısal string kabul edilir (`bilinenSayi`) — DB'den '120' gelen alan eskiden de `Number()` ile okunuyordu.
 *
 * ## BİLİNÇLİ FARKLAR
 *  1. Bilinen 0 stok → değer GERÇEK 0'dır, fiyat/maliyet aranmaz (finansalOranlar.stokDegeri'ndeki
 *     istisna; fiyatsız ama stoksuz eski kalemler "tutarsız" sayacını şişirmesin). Satış tarafı
 *     zaten `stokDegeri`ye DELEGE edilir — tek kaynak; maliyet tarafı aynı kuralı `degerToplami` ile
 *     uygular (depoDeger.depoToplamlari'ndaki "0 stok istisnası YOK" kararı BURAYA taşınmadı: orada
 *     kalem bazlı depo dökümü, burada firma geneli stok değeri var).
 *  2. `lowStockThreshold` yoksa kalem "düşük stok" da "yeterli" de sayılmaz — `esikBilinmeyen`
 *     kovasına girer (eski `?? 5` uydurmasının yerine). Sayfa bu kovayı sayı olarak bildirir.
 *  3. Tanınmayan/eksik sipariş durumu `diger` olarak SAYILIR (eskiden görünmezdi).
 *  4. Ürün kovası `sku`, yoksa `name`, o da yoksa TEK "tanımsız" kovası (`anahtar: null`) — eski
 *     kod bunları `'Unknown'` adıyla ekrana basıyordu (İngilizce sızıntısı + sahte ürün adı).
 *  5. Tarihi bilinmeyen sevkiyat sıralamada epoch (0) değil, `sayiSirala` ile HER İKİ yönde SONDA.
 *
 * ## 6b EKİ (2026-09-24, Faz 3 6/n Genel I) — `urunSatislari` (ADDITIVE; `enCokSatanlar` sözleşmesi DEĞİŞMEZ)
 * `enCokSatanlar`ın İÇ gruplaması `urunSatislari` adıyla dışa açıldı; `enCokSatanlar(s, n)` gövdesi artık
 * `urunSatislari(s).slice(0, n)` + `barOrani` (PLAN-v2 §3.1 Y16). İki 6b tüketicisi aynı işi ayrı ayrı, ayrı
 * arızalarla yapıyordu (HEAD 912d750'de teyit):
 *   A · src/components/reports/UrunlerRapor.tsx:57-75
 *     :63  `const qty = Number(liR.quantity ?? 1) || 1;`                        — miktarı bilinmeyen kalem 1 ADET (kg/ton işinde uydurma)
 *     :64  `Number(liR.unitPrice ?? liR.price ?? liR.variant_price ?? 0) || 0`  — fiyatı bilinmeyen ₺0; `unitPrice`/`variant_price`
 *          HAYALET ALAN (sipariş satırına bu adları YAZAN kod yok: types.ts:91-102 OrderLineItem, server.ts:431-435 Shopify)
 *     :61  `… ?? 'Unknown'`                                                      — adsız kalem sahte ürün satırı (İngilizce sızıntısı)
 *     :70  `prodMap[key].orderCount++;`                                          — KALEM sayıyor, sipariş değil
 *     :74  `avgOrderValue: p.orderCount > 0 ? … : 0`                             — türetme, `: 0` sahte kesinliği
 *   B · src/components/reports/genel/GenelBloklar1.tsx:586-637 (Phase 217 Ürün Karma, Top 6)
 *     :595 `prodRev217[key].rev += li.price * li.quantity;`                      — KORUMASIZ ÇARPIM: `undefined * 4` → NaN,
 *          `null * 4` → 0; tek NaN `total217`i (:601) komple NaN yapıyor → TÜM yüzdeler '%0'
 *     :599 `.sort((a, b) => b.rev - a.rev).slice(0, 6)`                          — NaN karşılaştırıcı "Top 6"yı yanlış seçiyor
 *     :601 `total217 = sorted217.reduce(…)`                                       — payda YALNIZ ilk 6 ürün → K21
 * PARİTE (Pano): `enCokSatanlar` çıktısı — anahtar, ad, adet, ciro, sıra, `barOrani` — DEĞİŞMEZ; tek ek `siparisSayisi`.
 * BİLİNÇLİ FARKLAR (urunSatislari tüketicileri için):
 *   1. `unitPrice` / `variant_price` yedekleri DÜŞER (yazan kod yok — ölçüldü).
 *   2. `'Unknown'` ürün adı kalkar → `ad: null` → ekranda '—' (yukarıdaki "BİLİNÇLİ FARKLAR 4" ile aynı karar).
 *   3. `siparisSayisi` kalem değil BENZERSİZ sipariş sayar → UrunlerRapor "Sipariş" sütunu DÜŞEBİLİR, ürün başına
 *      ortalama sipariş değeri YÜKSELİR (görünür; orkestratöre açık soru).
 *   4. GB1 P217 anahtarı `inventoryId` yerine `sku → name` ile başlar (açık soru).
 * K2 ("İptaller ciroya girsin mi → hayır"): iptal süzgeci BURADA YOK — `SatisSiparisi` `status` OKUMAZ; iç süzgeç
 *   Pano'nun (DashboardPage:2108 HAM `orders`) sözleşmesini değiştirirdi. İki 6b tüketicisi bugün zaten iptalleri
 *   atıyor (UrunlerRapor:58, GenelBloklar1:590) → K2 orada rakam DEĞİŞTİRMEZ, süzgeç yalnız KORUNUR.
 * K21 kullanıcı 2026-09-24: "Tüm ciro" (KARARLAR.md) — `urunSatislari` TÜM ürünleri döndürür; "Top N" yalnız GÖSTERİM
 *   için çağıranda kesilir, pay paydası TÜM liste.
 * K-KALEM=A (6b hakem turu 2026-09-24, bulgu 1; ADDITIVE): `UrunSatisSecenek.tutarSec` + `SatisSatiri.total`. Mikro
 *   faturasından türeyen kalem `price` TAŞIMAZ, tutarı `total`da (KDV dâhil — src/server/mikro/eslemeFatura.ts:166-171);
 *   varsayılan `satirTutari(price, quantity)` onu "tutarı okunamadı" sayıyor, `tamTutar` kapısı da TÜM ürünlerin payını
 *   '—' yapıyordu (tutarı yazılı faturaya "okunamadı" = yanlış neden). Kullanıcı K3 (KARARLAR.md): "evet / ana program
 *   zaten bu." → Mikro verisi KATILIR. Seçici VERİLMEZSE eski yol (Pano paritesi: `enCokSatanlar` geçmez, 5/n testleri sabit).
 */
import { bilinenSayi, satirTutari, toplaBilinen, sayiSirala, tamTutar, ekranTutari, type Tutar } from '../para';
import { olcekReferansi, cubukOrani, tutarSatiri } from './cubuk';
import { adetYaz } from '../muhasebe/depoDeger';
import { stokDegeri } from '../muhasebe/finansalOranlar';
import { oranYuzde } from '../siparisler/lojistikKpi';
import { zamanDate, zamanMs } from '../zaman';

// ─────────────────────────────────────────────────────────────────────────────
// Stok değeri özeti (Phase 47) + düşük stok kapısı (Phase 24)
// ─────────────────────────────────────────────────────────────────────────────

/** Stok kartının bu modülün okuduğu alanları — yapısal, `InventoryItem` tipine bağımlı değil. */
export interface StokKalemi {
  stockLevel?: unknown;
  lowStockThreshold?: unknown;
  minStock?: unknown;
  prices?: Record<string, unknown>;
  price?: unknown;
  costPrice?: unknown;
  cost?: unknown;
}

/**
 * Bir stok listesinin değeri: Σ (birim değer × stockLevel). Birim değer ya da stok bilinmiyorsa
 * kalem toplama GİRMEZ, `bilinmeyen` olarak SAYILIR. Bilinen 0 stok istisnadır: değer gerçek 0'dır,
 * birim değer aranmaz. (Satış tarafının referansı `finansalOranlar.stokDegeri`; testte iki hesabın
 * aynı sayıyı verdiği doğrulanır — kopya kod değil, aynı kural.)
 */
export function degerToplami<T extends StokKalemi>(
  kalemler: readonly T[],
  birimDeger: (k: T) => unknown,
): Tutar {
  return toplaBilinen(kalemler, k => {
    if (bilinenSayi(k.stockLevel) && Number(k.stockLevel) === 0) return 0;
    return satirTutari(birimDeger(k), k.stockLevel);
  });
}

export interface StokDegeriSecenek<T> {
  /** Birim MALİYET çözücüsü. Sayfa kur çevrimli `kartMaliyetiTL(i, rates)` geçer (bilinmiyorsa null). */
  maliyet?: (k: T) => unknown;
  /** Birim SATIŞ fiyatı çözücüsü. Verilmezse `finansalOranlar.stokDegeri` kuralı (Retail ?? price). */
  satis?: (k: T) => unknown;
}

export interface StokDegeriOzeti {
  /** Σ maliyet × stok — ekran `ekranTutari`, yanında `bilinmeyen > 0` ise "N kalem maliyetsiz". */
  maliyet: Tutar;
  /** Σ satış fiyatı × stok. */
  satis: Tutar;
  /** Σ stockLevel — adedi bilinmeyen kalem SAYILIR. */
  adet: Tutar;
  /** Brüt marj yüzdesi — TÜRETME: tek kalem bile tutarsızsa ya da satış toplamı ≤ 0 ise null ('—'). */
  marj: number | null;
}

/** Phase 47 "Stok Değeri Özeti" kartının dört sayısı. */
export function stokDegeriOzeti<T extends StokKalemi>(
  kalemler: readonly T[],
  secenek: StokDegeriSecenek<T> = {},
): StokDegeriOzeti {
  const maliyet = degerToplami(kalemler, secenek.maliyet ?? (k => k.costPrice ?? k.cost));
  const satis = secenek.satis ? degerToplami(kalemler, secenek.satis) : stokDegeri(kalemler);
  const adet = toplaBilinen(kalemler, k => k.stockLevel);
  // TÜRETME kapısı: kısmi toplamdan marj çıkarılmaz (tamTutar bir kalem eksikse NaN → oranYuzde null).
  const oran = oranYuzde(tamTutar(satis) - tamTutar(maliyet), tamTutar(satis));
  return { maliyet, satis, adet, marj: oran === null ? null : Math.round(oran) };
}

/** Eşik çözücüsü — sayfadaki `lowStockThreshold ?? minStock` sırası; uydurma varsayılan YOK. */
const varsayilanEsik = (k: StokKalemi): unknown => k.lowStockThreshold ?? k.minStock;

export interface DusukStokSonucu<T> {
  /** Stok ve eşik BİLİNİYOR ve stok ≤ eşik. */
  dusuk: T[];
  /** Stoğu bilinmeyen kalem — düşük mü değil mi BİLİNMİYOR (eski `?? 0` bunları uyarıya sokuyordu). */
  stokBilinmeyen: T[];
  /** Eşiği bilinmeyen kalem — kıyas yapılamaz (eski `?? 5` uydurma eşikle kıyaslıyordu). */
  esikBilinmeyen: T[];
}

/**
 * Düşük stok kapısı. Sıra önemli: önce stok, sonra eşik — ikisi de bilinmiyorsa kalem
 * `stokBilinmeyen`de sayılır (kullanıcıya önce "stoğu bilinmiyor" demek daha bilgilendirici).
 */
export function dusukStokKalemleri<T extends StokKalemi>(
  kalemler: readonly T[],
  esikSec: (k: T) => unknown = varsayilanEsik,
): DusukStokSonucu<T> {
  const dusuk: T[] = [], stokBilinmeyen: T[] = [], esikBilinmeyen: T[] = [];
  for (const k of kalemler) {
    if (!bilinenSayi(k.stockLevel)) { stokBilinmeyen.push(k); continue; }
    const esik = esikSec(k);
    if (!bilinenSayi(esik)) { esikBilinmeyen.push(k); continue; }
    if (Number(k.stockLevel) <= Number(esik)) dusuk.push(k);
  }
  return { dusuk, stokBilinmeyen, esikBilinmeyen };
}

/** Ajanda satırının "stok / eşik" metni — bilinmeyen taraf '—' (eski "0 / 5" yerine). */
export function stokEsikYaz(k: StokKalemi, esikSec: (k: StokKalemi) => unknown = varsayilanEsik): string {
  return `${adetYaz(k.stockLevel)} / ${adetYaz(esikSec(k))}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// En çok satan ürünler
// ─────────────────────────────────────────────────────────────────────────────

/** Sipariş satırının okunan alanları (OrderLineItem'e yapısal olarak uyar). */
export interface SatisSatiri {
  sku?: unknown; name?: unknown; title?: unknown; quantity?: unknown; price?: unknown;
  /** Satır tutarı (Mikro türevi kalem: KDV DÂHİL, `price` yok). Sürüm-2 kalemde = netTutar + kdv. */
  total?: unknown;
  /** Sürüm-2 Mikro türevi kalem (2026-09-25, eslemeFatura MF_KALEM_SURUMU): KDV HARİÇ, iskonto düşülmüş — ciro (K-KALEM). */
  netTutar?: unknown;
}
export interface SatisSiparisi { lineItems?: readonly SatisSatiri[] | null }

/** `enCokSatanlar`ın satırı, çubuk oranı OLMADAN — tüm ürünlerin listesi (6b eki). */
export interface UrunSatisSatiri {
  /** Kova anahtarı: `sku`, yoksa `name` (seçenekle `title`); hiçbiri yoksa null (tek "tanımsız" kovası). */
  anahtar: string | null;
  /** Ekranda gösterilecek ad: `name` → `title` → anahtar; hiçbiri yoksa null → sayfa '—' basar. */
  ad: string | null;
  /** Σ quantity — adedi bilinmeyen satır SAYILIR (eski `|| 1` ile 1 adet sayılıyordu). */
  adet: Tutar;
  /** Σ fiyat × adet — fiyatı ya da adedi bilinmeyen satır SAYILIR (eski `|| 0` ile ₺0 sayılıyordu). */
  ciro: Tutar;
  /** Bu ürünü içeren BENZERSİZ sipariş sayısı (aynı siparişteki iki satır 1 sayılır; UrunlerRapor:70 kalem sayıyordu). */
  siparisSayisi: number;
}

export interface UrunSatis extends UrunSatisSatiri {
  /**
   * Ölçek çubuğunun genişliği (%); ölçek ya da satırın KENDİ cirosu kısmiyse `null` →
   * çubuk ÇİZİLMEZ (kural: `utils/pano/cubuk`; `musteriAnaliz` panelleriyle aynı).
   */
  barOrani: number | null;
}

export interface UrunSatisSecenek {
  /**
   * Anahtar zincirine `title` yedeğini EKLER: `sku → name → title`.
   * Varsayılan KAPALI = Pano paritesi (`enCokSatanlar` bu seçeneği GEÇMEZ).
   * Shopify webhook'u sipariş satırına `name` YAZMIYOR, `title` yazıyor (server.ts:431-435) —
   * UrunlerRapor bugün o kalemleri başlıkla ayrı satırlarda gösteriyor; bağlama `true` geçer.
   */
  baslikYedegi?: boolean;
  /**
   * Satır cirosu seçicisi (K-KALEM=A, 6b hakem 2026-09-24). Dönüş `toplaBilinen`e girer: sonlu sayı/sayısal metin
   * BİLİNİR, aksi (NaN/null/undefined) SAYILIR — 0 sayılmaz. Verilmezse `satirTutari(price, quantity)` = Pano paritesi
   * (`enCokSatanlar` bu seçeneği GEÇMEZ). UrunlerRapor `total` biliniyorsa onu, yoksa fiyat × adet geçer.
   */
  tutarSec?: (s: SatisSatiri) => unknown;
}

/** Boş olmayan metin/sonlu sayı → string; aksi hâlde null (boş sku ada düşsün diye). */
function metin(x: unknown): string | null {
  if (typeof x === 'string') { const s = x.trim(); return s === '' ? null : s; }
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return null;
}

/**
 * Ciroya göre AZALAN sıralı TÜM ürünler — KESİLMEZ (6b eki, 2026-09-24). "Top N" gösterim kararı ÇAĞIRANDA.
 * // K21 kullanıcı 2026-09-24: "Tüm ciro" (KARARLAR.md) — pay paydası bu listenin TAMAMIDIR, ilk N değil.
 *
 * Anahtar/ad/tutar kuralları `enCokSatanlar`ınkiyle BİREBİR AYNI (tek gövde — `enCokSatanlar` buna delege eder):
 * anahtar `metin(sku) ?? metin(name)` (+ `baslikYedegi` ile `?? metin(title)`), ad `metin(name) ?? metin(title) ??
 * anahtar` (İLK satırdan — eski `productCount[k] = productCount[k] || {...}` davranışı), adet `toplaBilinen(quantity)`,
 * ciro `toplaBilinen(tutarSec ?? satirTutari(price, quantity))` (K-KALEM=A: seçici çağıranın). Adsız kalem TEK `null` kovası (5/n kararı).
 * `siparisSayisi`: ürünün geçtiği BENZERSİZ sipariş (nesne kimliği) — aynı siparişte iki satır 1 sayılır.
 * Sıralama `sayiSirala(ekranTutari(a.ciro), ekranTutari(b.ciro), true)`: cirosu hiç bilinmeyen ürün listenin
 * ORTASINA ₺0 gibi dizilmez, SONA gider. İptal süzgeci YOK (K2 — çağıranda; `SatisSiparisi` `status` okumaz).
 * Girdi mutasyona uğramaz; `lineItems` `null`/`undefined` ise sipariş ürün eklemez.
 */
export function urunSatislari(
  siparisler: readonly SatisSiparisi[],
  secenek: UrunSatisSecenek = {},
): UrunSatisSatiri[] {
  const kovalar = new Map<string | null, { ad: string | null; satirlar: SatisSatiri[]; siparisler: Set<SatisSiparisi> }>();
  // Seçici yoksa eski yol (Pano paritesi); `??` burada sayı yedeği DEĞİL, fonksiyon yedeğidir.
  const tutar = secenek.tutarSec ?? ((s: SatisSatiri) => satirTutari(s.price, s.quantity));
  for (const o of siparisler) {
    for (const l of o.lineItems ?? []) {
      const anahtar = metin(l.sku) ?? metin(l.name) ?? (secenek.baslikYedegi === true ? metin(l.title) : null);
      let kova = kovalar.get(anahtar);
      if (!kova) {
        // Ad İLK satırdan alınır (eski `productCount[k] = productCount[k] || {...}` davranışı). ANAHTARSIZ kova
        // (sku/ad/başlık yok) BİRDEN ÇOK ürünü toplar → ilk satırın başlığı o toplamın adı OLAMAZ: ad null → ekran '—'
        // (inceleme 2026-09-25; Pano `enCokSatanlar` da aynı yanlış etiketi basıyordu).
        kova = { ad: anahtar === null ? null : (metin(l.name) ?? metin(l.title) ?? anahtar), satirlar: [], siparisler: new Set() };
        kovalar.set(anahtar, kova);
      }
      kova.satirlar.push(l);
      kova.siparisler.add(o);                                   // benzersiz sipariş: aynı siparişin 2. satırı eklemez
    }
  }
  return [...kovalar.entries()]
    .map(([anahtar, k]): UrunSatisSatiri => ({
      anahtar,
      ad: k.ad,
      adet: toplaBilinen(k.satirlar, s => s.quantity),
      ciro: toplaBilinen(k.satirlar, tutar),
      siparisSayisi: k.siparisler.size,
    }))
    // Sıralama anahtarı EKRAN toplamı: hiç bilinen satırı olmayan ürün NaN verir →
    // `sayiSirala` onu her iki yönde SONA koyar (yerel `ekranCiro` kopyası silindi).
    .sort((a, b) => sayiSirala(ekranTutari(a.ciro), ekranTutari(b.ciro), true));
}

/**
 * K-KALEM=A satır cirosu seçicisi — TEK tanım (6b kapanış turu 2026-09-24, bulgu 4 + 6; ADDITIVE).
 * GenelBloklar1 P217 ve UrunlerRapor bunu `tutarSec` olarak geçer. Eskiden iki dosyada SATIR İÇİ KOPYAydı
 * (GB1:155 ≡ UrunlerRapor:113): karar B'ye dönse biri unutulur, Genel sekmesi ile Ürün Performansı AYNI ürünün
 * cirosunu FARKLI basardı (yarım düzeltme sınıfı). Şimdi YALNIZ bu gövde değişir.
 * Kural: `total` biliniyorsa o (Mikro faturası türevi kalem `price` TAŞIMAZ, tutarı `total`da — KDV DÂHİL,
 * src/server/mikro/eslemeFatura.ts:166-171); yoksa `satirTutari(price, quantity)` (native: KDV HARİÇ; biri
 * bilinmiyorsa NaN → `toplaBilinen` SAYAR; `Number(null) * 4 === 0` tuzağına GİRMEZ). Bilinen `total: 0` GERÇEK 0.
 * Dayanak kullanıcı K3 (KARARLAR.md): "evet / ana program zaten bu." — K-KALEM'in KENDİ kullanıcı cümlesi
 * KARARLAR.md'de HENÜZ YOK (açık soru; orkestratör soracak).
 */
export function kalemTutari(s: SatisSatiri): number {
  // Sürüm-2 Mikro kalemi (2026-09-25): KDV hariç NET varsa O — K-KALEM "KDV hariç" kararının uygulandığı yer.
  // Eski kalem (yalnız KDV dâhil `total`) aynen okunur; dipnot kapısı `kdvDahilKalemVar` onu bildirir.
  if (bilinenSayi(s.netTutar)) return Number(s.netTutar);
  return bilinenSayi(s.total) ? Number(s.total) : satirTutari(s.price, s.quantity);
}

/**
 * Ekranda satırın BİRİM fiyatı, `kalemTutari` ile aynı kaynaktan: `price` biliniyorsa o; yoksa (Mikro türevi kalem)
 * `total / quantity` (KDV dâhil — `kdvDahilKalemVar` dipnotu); ikisi de yoksa ya da miktar 0 ise NaN ('—').
 * Neden (2026-09-25, MF-383): sipariş detayı ve fişi Mikro kalemine `price` okuyup birim ve tutarı '—' basıyordu.
 */
export function kalemBirimFiyati(s: SatisSatiri): number {
  if (bilinenSayi(s.price)) return Number(s.price);
  if (bilinenSayi(s.netTutar) && bilinenSayi(s.quantity) && Number(s.quantity) !== 0) return Number(s.netTutar) / Number(s.quantity);
  if (bilinenSayi(s.total) && bilinenSayi(s.quantity) && Number(s.quantity) !== 0) return Number(s.total) / Number(s.quantity);
  return NaN;
}

/**
 * `kalemTutari`nin `total` yolu en az BİR kalemde kullanıldı mı — "Mikro faturasından türeyen kalemlerde satır
 * tutarı KDV dâhildir" dipnotunun kapısı (seçicinin ilk dalıyla AYNI kural: `total` alanının VARLIĞI değil,
 * BİLİNİRLİĞİ). Mikro'suz kiracıda dipnot basılmaz — açıkladığı satır yoksa not gürültüdür. `lineItems`
 * null/undefined ise sipariş kalem katmaz; iptal süzgeci ÇAĞIRANDA (K2).
 */
export function kdvDahilKalemVar(siparisler: readonly SatisSiparisi[]): boolean {
  // Sürüm-2 kalem KDV hariç net taşır → `total` yolu kullanılmaz, dipnot gereksiz (2026-09-25).
  return siparisler.some(o => (o.lineItems ?? []).some(l => bilinenSayi(l.total) && !bilinenSayi(l.netTutar)));
}

/**
 * Ciroya göre en çok satan ilk `n` ürün. Cirosu hiç bilinmeyen ürün listenin ORTASINA ₺0 gibi
 * dizilmez — `sayiSirala` ile SONA gider (her iki yönde).
 *
 * Çubuk oranı (`barOrani`) BURADA üretilir, sayfada değil (2026-09-19 hakem turu): sayfa
 * ölçeği kısmi tepeden alıp (`maxRevTop`) her satıra `oranYuzde(ekranTutari(...))` çiziyordu,
 * yani fiyatsız satırı olan ürün kısa bir çubukla yanlış bir sıralama izlenimi veriyordu.
 * Kural `./cubuk`ta tek kaynak — `musteriAnaliz` panelleri de aynı kuralı okur.
 *
 * 6b (2026-09-24): gruplama/sıralama `urunSatislari`a DELEGE — iki kopya gruplama sessizce ayrışmasın
 * (5/n dersi). Sözleşme (imza, anahtar/ad/tutar, sıra, `barOrani`, tek `null` kovası) DEĞİŞMEDİ.
 */
export function enCokSatanlar(siparisler: readonly SatisSiparisi[], n: number, tutarSec?: (s: SatisSatiri) => number): UrunSatis[] {
  // Ölçek GÖSTERİLEN listeye göre kurulur (sayfa da `top5` üzerinden ölçekliyordu).
  // `tutarSec` verilmezse eski yol (price × quantity) — sayfa paritesi testleri.
  const ilkN = urunSatislari(siparisler, tutarSec ? { tutarSec } : {}).slice(0, n);
  const referans = olcekReferansi(ilkN.map(u => tutarSatiri(u.ciro)));
  return ilkN.map(u => ({ ...u, barOrani: cubukOrani(tutarSatiri(u.ciro), referans) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sipariş durum dağılımı (Phase 43)
// ─────────────────────────────────────────────────────────────────────────────

/** Panodaki durum çubuğunun bildiği durumlar (sayfadaki `statusConfig` sırası). */
export const PANO_DURUMLARI = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] as const;

export interface DurumSiparisi { status?: unknown }

export interface DurumDagilimi {
  /** Bilinen her durum için sayı — 0 başlatma MEŞRU sayaçtır ("o durumda hiç sipariş yok"). */
  sayilar: Record<string, number>;
  /** Durumu eksik ya da listede olmayan sipariş sayısı — eskiden çubuktan sessizce düşüyordu. */
  diger: number;
  /** Tüm siparişler; `Σ sayilar + diger === toplam` (değişmez). */
  toplam: number;
}

export function durumDagilimi(siparisler: readonly DurumSiparisi[], anahtarlar: readonly string[]): DurumDagilimi {
  const sayilar: Record<string, number> = {};
  for (const k of anahtarlar) sayilar[k] = 0;
  let diger = 0;
  for (const o of siparisler) {
    const s = typeof o.status === 'string' ? o.status : null;
    if (s !== null && s in sayilar) sayilar[s] += 1;
    else diger += 1;
  }
  return { sayilar, diger, toplam: siparisler.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Haftalık sipariş ısı haritası (Phase 73)
// ─────────────────────────────────────────────────────────────────────────────

export interface TarihliSiparis { createdAt?: unknown; syncedAt?: unknown }

export interface IsiHaritasi {
  /** 7 kova, indeks = `Date.getDay()` (0 = Pazar) — sayfa etiketleri bu sırayla dizer. */
  sayilar: number[];
  /** Tarihi ÇÖZÜLEN sipariş sayısı (Σ sayilar). */
  toplam: number;
  /** Tarihi çözülemeyen sipariş sayısı — hiçbir güne yazılmaz, SAYILIR ("N sipariş tarihsiz"). */
  tarihsiz: number;
  /** En yoğun günün indeksi; hiç tarih çözülemediyse null — rozet ÇİZİLMEZ ("En yoğun: Paz" uydurması). */
  enYogunGun: number | null;
  /** En yüksek kova (çubuk ölçeği); hiç kayıt yoksa 0 — sayfa oranı `oranYuzde` ile sorar. */
  enYuksek: number;
}

/** Sayfa paritesi: tarih `createdAt ?? syncedAt` (alan VARSA ve çözülemiyorsa yedeğe DÜŞÜLMEZ). */
const varsayilanSiparisTarihi = (o: TarihliSiparis): unknown => o.createdAt ?? o.syncedAt;

export function haftaIciIsiHaritasi<T extends TarihliSiparis>(
  siparisler: readonly T[],
  tarihSec: (o: T) => unknown = varsayilanSiparisTarihi,
): IsiHaritasi {
  const sayilar = [0, 0, 0, 0, 0, 0, 0];
  let tarihsiz = 0;
  for (const o of siparisler) {
    const d = zamanDate(tarihSec(o));
    if (!d) { tarihsiz += 1; continue; }
    sayilar[d.getDay()] += 1;
  }
  const toplam = sayilar.reduce((a, b) => a + b, 0);
  const enYuksek = Math.max(...sayilar);
  return { sayilar, toplam, tarihsiz, enYogunGun: toplam === 0 ? null : sayilar.indexOf(enYuksek), enYuksek };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sevkiyat mini-widget'ı (Phase 539)
// ─────────────────────────────────────────────────────────────────────────────

export interface SevkiyatBenzeri { createdAt?: unknown }

/**
 * En yeni `n` sevkiyat. Eski sıralayıcı `zamanMs(...) ?? 0` idi: azalan yönde bilinmeyen tarih
 * sona düşüyordu (doğru) ama yön çevrilirse sessizce BAŞA geçerdi. `sayiSirala` yönden bağımsız
 * olarak bilinmeyeni sona koyar. Girdi dizisi DEĞİŞTİRİLMEZ (sayfa state'i canlı liste).
 */
export function sonSevkiyatlar<T extends SevkiyatBenzeri>(
  sevkiyatlar: readonly T[],
  n: number,
  tarihSec: (s: T) => unknown = s => s.createdAt,
): T[] {
  return [...sevkiyatlar]
    .sort((a, b) => sayiSirala(zamanMs(tarihSec(a)), zamanMs(tarihSec(b)), true))
    .slice(0, n);
}
