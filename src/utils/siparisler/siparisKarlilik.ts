/**
 * siparisKarlilik.ts — sipariş kârlılığının TEK kaynağı (Faz 3 4/n, grup "siparisKarlilik").
 * Test: `siparisKarlilik.test.ts` (önce yazıldı, kırmızı görüldü).
 *
 * ## NEDEN VAR — sahte kesinlik siteleri (OrdersPage.tsx, taşımadan önceki satırlar)
 *
 *  • ~1971-1977 **Phase 513 popup**
 *      `const revenue = selectedOrder.totalPrice || 0;`
 *      `... li.costPrice ?? (inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) ...`
 *      `const margin = revenue > 0 ? (gp / revenue * 100) : 0;`
 *    Üç ayrı uydurma: (a) tutarı bilinmeyen sipariş ₺0 ciro sayılıp "Kâr %0,0" kırmızı
 *    rozetiyle gösteriliyordu; (b) maliyeti bilinmeyen kalem için **%60 sabit maliyet oranı**
 *    uyduruluyordu (hiçbir veriye dayanmıyor); (c) `itemCostTRY` kuru çevrilemeyen kalem için
 *    0 döner — o kalem sessizce "maliyetsiz" olup marjı şişiriyordu.
 *
 *  • ~2286-2291 **Phase 74 "Tahmini Brüt Kâr" kutusu** — aynı modalde İKİNCİ, farklı kopya:
 *      `const hasCost = selectedOrder.lineItems.some(l => (l.costPrice ?? 0) > 0);`
 *      `const cost = ...reduce((s, l) => s + ((l.costPrice ?? 0) * l.quantity), 0);`
 *    `hasCost` kapısı yalnız "HİÇ maliyet yok" hâlini eliyordu: KARIŞIK siparişte (bir kalemin
 *    maliyeti var, diğerininki yok) kapı açılıyor ve eksik maliyet 0 sayılıp marj şişiyordu.
 *    Üstelik ciro tabanı popup'takinden farklıydı (Σ price×quantity ↔ totalPrice), yani aynı
 *    sipariş için ekranda aynı anda İKİ FARKLI marj görünebiliyordu.
 *
 *  • ~1919 **WhatsApp özeti** — `kurCevir(o.totalPrice || 0, …)`: tutarı bilinmeyen sipariş
 *    MÜŞTERİYE giden metinde "₺0" oluyordu.
 *
 *  • ~2270 **kalem tablosu alt toplamı** — `$${…reduce(…).toFixed(2)}`: TL tutarı '$' sembolüyle
 *    ve fiyatı bilinmeyen kalemde "NaN".
 *
 * ## PARİTE (bilinen girdide sayı eskiyle birebir)
 * Tüm kalemlerin fiyat/miktar/maliyeti bilinen Cetpa-native siparişte ciro, maliyet, kâr ve marj
 * eski iki bloğun verdiği sayının AYNISI (AddOrderModal `computedTotal = Σ price×quantity` ve
 * App.tsx `finalTotal = computedTotal` olduğu için iki ciro tabanı bu kayıtlarda zaten eşit).
 * Marj ham yüzde döner; biçim çağıranda kalır — popup `toFixed(1)`, kutu `Math.round`.
 *
 * ## BİLİNÇLİ FARKLAR
 *  1. **Ciro tabanı kalem cirosudur** (Σ price×quantity), başlık `totalPrice` değil. Maliyet
 *     kalemlerden geliyor; kârın iki tarafı aynı tabanda olmalı. Mikro faturasından türetilen
 *     siparişte başlık tutarı `cha_meblag` yani KDV DAHİL (src/server/mikro/eslemeFatura.ts:273);
 *     eski popup bunu net maliyetle karşılaştırıp marjı ~KDV oranı kadar şişiriyordu. Kalemi
 *     olmayan siparişte ciro `siparisTutari` (totalPrice ?? totalAmount) ile okunur — o hâlde
 *     maliyet zaten bilinmez, kâr üretilmez.
 *  2. **%60 uydurma maliyet oranı kaldırıldı.** Kalemin kendi `costPrice`'ı yoksa (ve çözücü de
 *     bilmiyorsa) o kalem maliyetsizdir: kâr/marj HESAPLANMAZ, `maliyetsizKalem` sayılır ve ekran
 *     "N kalemin maliyeti bilinmiyor" der. Yüzde çubuğu/rozet çizilmez.
 *  3. **Stok maliyeti çözücüsü opsiyonel ve AÇIK.** Sayfa, kalemin stok kartındaki maliyetini
 *     vermek isterse `kalemMaliyeti` geçer. Çözücü bilinmeyeni `null`/`NaN` ile bildirmeli —
 *     `itemCostTRY` çevrilemeyen kalem için 0 döndüğü (cost.ts'te belgeli) için DOĞRUDAN
 *     kullanılmamalı; `maliyetDurumu(...).durum === 'tl'` süzgecinden geçirilmeli.
 *  4. **`costPrice: 0` meşru bir maliyettir** (promosyon/bedelsiz kalem) — "bilinmiyor" sayılmaz.
 *     Eski `hasCost` kapısı maliyeti sıfır olan siparişte kutuyu tümden gizliyordu.
 *
 * Saf modül: React/DB yok, kullanıcı metni yok (dil seçimi çağıranda).
 */
import { bilinenSayi, satirTutari, toplaBilinen, tamTutar, siparisMaliyeti, type Tutar } from '../para';
import { siparisTutari, type SiparisTutarAlanlari } from '../siparis';
import { paraYaz, kurCevir, type ExchangeRates } from '../currency';

/** Tutarı bilinmeyen sayının ekran/metin karşılığı — çağıran bu değeri müşteri metnine BASMAMALI. */
export const BILINMIYOR = '—';

/** Sipariş satırı — yapısal (kanonik `OrderLineItem` ve yerel türevleri uyar; bkz. siparis.ts). */
export interface KarlilikSatiri {
  price?: unknown;
  quantity?: unknown;
  costPrice?: unknown;
}

/**
 * Sipariş — satır tipi GENERIC: çağıranın kendi kalem tipi (`OrderLineItem`) çözücüye AYNEN geçer,
 * böylece çözücü içinde `li.inventoryId` / `li.sku` okumak için `as` gerekmez (CLAUDE.md: `as any` yasak).
 */
export interface KarlilikSiparisi<S extends KarlilikSatiri = KarlilikSatiri> extends SiparisTutarAlanlari {
  lineItems?: readonly S[] | null;
}

/**
 * Kalemin kendi `costPrice`'ı YOKSA başvurulan birim maliyet kaynağı (ör. stok kartı).
 * Bilinmiyorsa `null` / `undefined` / `NaN` dönmeli — 0 "maliyetsiz" demektir, "bilinmiyor" değil.
 */
export type KalemMaliyetCozucu<S extends KarlilikSatiri = KarlilikSatiri> = (satir: S) => unknown;

/* ── Kalem → stok kartı eşleşmesi ─────────────────────────────────────────── */

/** Stok kartının eşleştirmede kullanılan alanları (`InventoryItem` yapısal olarak uyar). */
export interface EslesmeKarti { id?: unknown; sku?: unknown }
/** Kalemin eşleştirmede kullanılan alanları (`OrderLineItem` yapısal olarak uyar). */
export interface EslesmeSatiri { inventoryId?: unknown; sku?: unknown }

/** Eşleştirme anahtarı: yalnız DOLU metin. Boş/boşluk/metin olmayan → null (anahtar yok). */
function eslesmeAnahtari(x: unknown): string | null {
  return typeof x === 'string' && x.trim() !== '' ? x : null;
}

/**
 * Kalemi stok kartıyla eşleştirir: `inventoryId` YA DA `sku` tutan İLK kart (sayfadaki
 * `find(i => i.id === li.inventoryId || i.sku === li.sku)` ile aynı OR sırası — kimliğe öncelik
 * vermek davranış değişikliği olurdu, bu turda bilerek yapılmadı).
 *
 * BOŞ ANAHTAR EŞLEŞMEZ. Sayfadaki `inventory.find(i => i.id === li.inventoryId || i.sku === li.sku)`
 * kuralı `'' === ''` olduğu için SKU'su boş bir kalemi (serbest satır: "Nakliye bedeli", kanal
 * siparişi kalemi — `OrderLineItem.sku` zorunlu string ama '' olabiliyor) katalogdaki SKU'su boş
 * İLK karta bağlıyordu; o ilgisiz kartın maliyeti "bilinen maliyet" sayılıp kâr/marj yeşil
 * basılıyordu (2026-09-19 delta bulgusu). Aynı kapı InventoryView:1266'da zaten vardı
 * (`!!mov.sku && p.sku === mov.sku`) — burada eksikti, yani yarım düzeltme sınıfı.
 *
 * Eşleşme yoksa `null`: kalem maliyetsizdir, kâr/marj HESAPLANMAZ.
 */
export function stokKartiBul<K extends EslesmeKarti>(kartlar: readonly K[], satir: EslesmeSatiri): K | null {
  const kimlik = eslesmeAnahtari(satir.inventoryId);
  const sku = eslesmeAnahtari(satir.sku);
  if (kimlik === null && sku === null) return null;
  return kartlar.find(k =>
    (kimlik !== null && eslesmeAnahtari(k.id) === kimlik) ||
    (sku !== null && eslesmeAnahtari(k.sku) === sku),
  ) ?? null;
}

/** Satır kırılımı (popup alt listesi). NaN = bilinmiyor → ekranda '—', renk/işaret yok. */
export interface SatirKarlilik {
  ciro: number;
  maliyet: number;
  kar: number;
}

export interface SiparisKarlilik {
  /** Kalem cirosu (Σ fiyat×miktar); kalem yoksa başlık tutarı. NaN = bilinmiyor. */
  ciro: number;
  /** COGS (Σ birim maliyet×miktar) — `para.siparisMaliyeti` kuralı. NaN = bilinmiyor. */
  maliyet: number;
  /** ciro − maliyet; TÜRETME kapısı: biri bile bilinmiyorsa NaN. */
  kar: number;
  /** Ham marj yüzdesi (biçimlendirme çağıranda). null = hesaplanamaz → çubuk/rozet ÇİZİLMEZ. */
  marjYuzde: number | null;
  /** Birim maliyeti (ya da miktarı) bilinmediği için maliyeti çıkmayan kalem sayısı. */
  maliyetsizKalem: number;
  satirlar: readonly SatirKarlilik[];
}

/**
 * Siparişin kârlılığı — Phase 513 popup'ı ile Phase 74 kutusunun TEK ortak hesabı.
 * Bir kalemin maliyeti bilinmiyorsa kâr ve marj üretilmez (kısmi maliyetten kâr çıkarmak,
 * eksik maliyet kadar uydurma kârdır); ekran `maliyetsizKalem` sayısını yazar.
 */
export function siparisKarliligi<S extends KarlilikSatiri>(
  o: KarlilikSiparisi<S>,
  kalemMaliyeti?: KalemMaliyetCozucu<S>,
): SiparisKarlilik {
  const ham = o.lineItems ?? [];

  // Birim maliyet satır başına BİR KEZ çözülür (çözücü stok araması yapabilir).
  const cozulmus = ham.map(s => ({
    price: s.price,
    quantity: s.quantity,
    costPrice: bilinenSayi(s.costPrice) ? s.costPrice : (kalemMaliyeti ? kalemMaliyeti(s) : undefined),
  }));

  const satirlar: SatirKarlilik[] = cozulmus.map(s => {
    const ciro = satirTutari(s.price, s.quantity);
    const maliyet = satirTutari(s.costPrice, s.quantity);
    return { ciro, maliyet, kar: Number.isFinite(ciro) && Number.isFinite(maliyet) ? ciro - maliyet : NaN };
  });

  const maliyetsizKalem = satirlar.reduce((n, s) => (Number.isFinite(s.maliyet) ? n : n + 1), 0);

  // COGS TEK KAYNAK: para.siparisMaliyeti (kalem yoksa NaN, tek bilinmeyen varsa NaN).
  const maliyet = siparisMaliyeti({ lineItems: cozulmus });

  // Ciro TÜRETİLEN sayıdır (kâra girer): tek kalem bile bilinmiyorsa kısmi toplam kullanılmaz.
  const ciro = ham.length > 0
    ? tamTutar(toplaBilinen(ham, s => satirTutari(s.price, s.quantity)))
    : siparisTutari(o);

  const kar = Number.isFinite(ciro) && Number.isFinite(maliyet) ? ciro - maliyet : NaN;
  const marjYuzde = Number.isFinite(kar) && ciro > 0 ? (kar / ciro) * 100 : null;

  return { ciro, maliyet, kar, marjYuzde, maliyetsizKalem, satirlar };
}

/**
 * Müşteriye gidecek metindeki (WhatsApp özeti, ödeme hatırlatması) sipariş tutarı.
 * Tutar bilinmiyorsa ya da kur yoksa `BILINMIYOR` ('—') döner — çağıran bu değeri metne
 * KOYMAMALI, mesajı hiç üretmeyip kullanıcıyı uyarmalı (2026-08-26 kararı: '—' müşteriye akmaz).
 *
 * Eski iki çağrı yeri de TL'de `kurCevir`i ATLIYORDU (`kpiCurrency === 'TRY' ? o.totalPrice : …`):
 * tutar bilinmiyorken `cv === null` kontrolü geçiyor ve WhatsApp özetinde "₺0" (`|| 0` yüzünden),
 * ödeme hatırlatmasında ise "… için — tutarındaki ödemeniz" metni müşteriye gidiyordu.
 */
export function mesajTutari(o: SiparisTutarAlanlari, birim: string, kurlar?: ExchangeRates | null, ondalik = 0): string {
  const tutar = siparisTutari(o);
  if (!Number.isFinite(tutar)) return BILINMIYOR;
  const cevrilen = kurCevir(tutar, birim, kurlar);   // 'TRY' → aynen döner
  if (cevrilen === null) return BILINMIYOR;
  return paraYaz(cevrilen, { birim, ondalik });
}

/**
 * Kalem tablosunun alt toplamı — EKRAN sözleşmesi (`ekranTutari` ile basılır): bilinen kalemlerin
 * KISMİ toplamı + `bilinmeyen` sayacı ("N kalemin tutarı bilinmiyor"); hiç bilinen yoksa NaN → '—'.
 * Kârın ciro tabanından (TÜRETME, `tamTutar`) bilerek AYRI: burada eksik kalem gizlenmez, YAZILIR.
 */
export function kalemlerTutari(o: KarlilikSiparisi): Tutar {
  return toplaBilinen(o.lineItems ?? [], s => satirTutari(s.price, s.quantity));
}
