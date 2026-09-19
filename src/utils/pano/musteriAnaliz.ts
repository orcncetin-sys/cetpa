/**
 * musteriAnaliz.ts — Pano (DashboardPage) müşteri analizi panellerinin TEK hesabı
 * (Faz 3 5/n, grup "musteriAnaliz"). Test: `musteriAnaliz.test.ts` (önce yazıldı, kırmızı görüldü).
 *
 * ## NEDEN VAR — sahte kesinlik siteleri (DashboardPage.tsx, taşımadan önceki satırlar)
 *
 *  • ~1325/1334 **Phase 160 Müşteri Ödeme Davranışı**
 *      `custPay[name].totalPaid += o.totalPrice || 0;`
 *      `custUnpaid[name] = (custUnpaid[name] ?? 0) + (o.totalPrice || 0);`
 *      `Object.values(custPay).sort((a, b) => b.totalPaid - a.totalPaid)`
 *    Tutarı okunamayan sipariş ₺0 sayılıyordu: müşteri "hiç ödememiş" gibi listenin dibine
 *    düşüyor, "Ödenmemiş Alacak" kartı da gerçekte olduğundan küçük görünüyordu.
 *
 *  • ~1467-1468 **Phase 79 B2B vs Perakende Ciro**
 *      `b2bRev = filteredOrders.filter(...).reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *      `b2bPct = Math.round((b2bRev / totalRev) * 100); retailPct = 100 - b2bPct;`
 *    Pay yüzdesi EKSİK bir toplamdan türetiliyordu; çubuk yine de %100 doluyordu.
 *
 *  • ~1514-1516 **Phase 106 Müşteri Tipine Göre Ciro (halka)** — aynı `|| 0` üç kez; halka
 *    dilimleri (`pct = s.rev / total106`), merkez rozeti ve üç ilerleme çubuğu kısmi toplamdan.
 *
 *  • ~1604 **Phase 124 Segment Kârlılığı**
 *      `segMap[type].revenue += o.totalPrice || 0;`
 *      `(inv ? itemCostTRY(inv, exchangeRates) : li.price * 0.6) * li.quantity`
 *      `margin = s.revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 100) : 0`
 *      `maxRev = Math.max(...segs.map(s => s.revenue))`
 *    Üç ayrı uydurma: maliyeti bilinmeyen kalem için **%60 sabit maliyet oranı** (hiçbir veriye
 *    dayanmıyor); `itemCostTRY` kuru çevrilemeyen kalem için 0 döndüğünden o kalem sessizce
 *    "bedelsiz" olup marjı şişiriyordu; cirosu bilinmeyen segment "%0 marj" kırmızı rozeti alıyordu.
 *
 *  • ~2122 **Phase 77 En İyi Müşteriler**
 *      `custMap[k].revenue += o.totalPrice || 0;` · `maxRev = top5[0].revenue`
 *      `pct = Math.round((c.revenue / maxRev) * 100)`
 *    Ölçek çubuğu, bilinmeyeni ₺0 sayan bir tepe değere göre çiziliyordu.
 *
 * ## PARİTE (bilinen girdide sayı eskiyle birebir)
 * Tüm siparişlerin tutarı bilinen bir veri setinde ciro toplamları, yüzdeler, marj, ortalama
 * sipariş ve çubuk oranları eski blokların verdiği sayının AYNISI. Biçimlendirme (Math.round,
 * `fmtKpi`, '%') ÇAĞIRANDA kalır — bu modül ham sayı döner.
 *
 * ## İKİ SÖZLEŞME (src/utils/para.ts — karıştırma)
 *  • `ciro` / `tutar` alanları **EKRAN** toplamıdır (`ekranTutari`): bilinenlerin KISMİ toplamı;
 *    hiç bilinen yoksa NaN → ekranda '—'. Yanına `tutarsiz*` sayacı gelir ("N kayıt tutarsız").
 *  • `yuzde`, `marjYuzde`, `ortalamaSiparis`, `barOrani` ve `kar`/`maliyet` **TÜRETMEDİR**
 *    (`tamTutar`): tek girdi bile bilinmiyorsa hesaplanmaz (`null` / NaN) ve ekranda yüzde
 *    çubuğu/rozet ÇİZİLMEZ.
 *
 * ## BİLİNÇLİ FARKLAR
 *  1. **%60 uydurma maliyet oranı kaldırıldı.** Segment marjı `siparisKarlilik.siparisKarliligi`
 *     üzerinden gelir: bir kalemin maliyeti bilinmiyorsa o siparişin maliyeti NaN, dolayısıyla
 *     segmentin marjı hesaplanmaz. Ekran `maliyetsizSiparis` sayısını yazar.
 *  2. **Kalemin kendi `costPrice`'ı önce okunur**, stok kartı yalnız o yoksa. Eski blok kalemin
 *     kaydedilmiş maliyetini hiç okumuyor, doğrudan GÜNCEL stok kartına bakıyordu — sipariş anındaki
 *     maliyeti bugünün kartıyla değiştirmek geçmiş marjı kur/zam hareketi kadar kaydırıyordu.
 *     (Aynı sözleşme OrdersPage'de Faz 3 4/n ile kuruldu.)
 *  3. **Stok kartı maliyeti `itemCostTRY` ile DOĞRUDAN çözülmez.** `itemCostTRY` çevrilemeyen
 *     kalem için 0 döner (cost.ts'te belgeli) ve 0 "bedelsiz" demektir, "bilinmiyor" değil.
 *     Sayfa `kartMaliyetiTL` (null döner) kullanmalı; çözücü sözleşmesi `KalemMaliyetCozucu`.
 *  4. **Adı olmayan müşteriler TEK kovada** toplanır (`ad === null` → ekranda '—'). Phase 77
 *     `custMap[o.customerName]` yazıyordu: adı olmayan siparişler "undefined" adlı SAHTE bir
 *     müşteri üretiyordu. Phase 160 zaten `o.customerName || '—'` ile aynı şeyi yapıyordu.
 *  5. **Ölçek çubuğu, tepe değer kısmiyse hiç çizilmez** (`barOrani === null`, `olcekGecerli`).
 *     Kısmi bir tepeye göre çizilen çubuk, alt satırları olduğundan uzun gösterir.
 *  6. `tipSegmenti` boşluktan ibaret `customerType`'ı da 'Retail' sayar (eski `|| 'Retail'`
 *     yalnız boş dizgiyi yakalıyordu); tanınmayan DOLU değer aynen korunur, kendi satırını alır.
 *  7. **Marjın paydası KALEM cirosudur, başlık tutarı değil** — ekranda GÖRÜNÜR değişiklik
 *     (2026-09-19 hakem turunda tespit edildi; test fikstürleri başlık = kalem toplamı olduğu
 *     için farkı gizliyordu). Eski Phase 124 `(revenue − cogs) / revenue` hesabını başlık
 *     `totalPrice` üzerinden yapıyordu; maliyet ise kalemlerden geliyordu. Mikro faturasından
 *     türeyen siparişte başlık KDV DAHİLdir (`src/server/mikro/eslemeFatura.ts`), dolayısıyla
 *     eski marj ~KDV oranı kadar ŞİŞİKTİ. Örnek: başlık ₺120.000, kalem toplamı ₺100.000,
 *     maliyet ₺80.000 → eski %33,3, yeni %20. `ciro` alanı (ekranda gösterilen tutar) başlık
 *     tabanında KALDI — yalnız marjın paydası değişti.
 *
 * ## İPTAL (Cancelled) FİLTRESİ NEREDE — eski bloklarla birebir
 *  • `odemeDavranisi`  → iptalleri ELER (Phase 160 `if (... o.status === 'Cancelled') continue`).
 *  • `segmentKarliligi`→ iptalleri ELER (Phase 124 `continue`).
 *  • `segmentCirosu` / `enIyiMusteriler` → ELEMEZ (Phase 79/106/77 de elemiyordu). Listeyi
 *    çağıran süzer; sayfa bugün `filteredOrders` (Phase 79) ve `orders` (106/77) veriyor.
 *
 * Saf modül: React/DB yok, kullanıcı metni yok (dil ve biçim çağıranda).
 */
import { toplaBilinen, ekranTutari, tamTutar, sayiSirala } from '../para';
import { olcekReferansi, cubukOrani, type CubukSatiri } from './cubuk';
import { siparisTutari, odemeTakipli, type SiparisTutarAlanlari } from '../siparis';
import type { SiparisKarlilik } from '../siparisler/siparisKarlilik';

/* ── Yapısal girdi tipleri ────────────────────────────────────────────────────
 * Kanonik `Order`a BAĞLI DEĞİL (bkz. siparis.ts): bazı bileşenler kendi daraltılmış
 * sipariş arayüzünü tanımlıyor; her fonksiyon GERÇEKTEN okuduğu alanları ister. */

/** Ciro/segment hesaplarının okuduğu alanlar. */
export interface SegmentSiparisi extends SiparisTutarAlanlari {
  status?: string;
}

/** Müşteri kırılımının okuduğu alanlar. */
export interface MusteriSiparisi extends SegmentSiparisi {
  customerName?: unknown;
  paid?: boolean;
  source?: string;
}

/** `customerType` okuyan segmentleyicilerin girdisi. */
export interface TipliSiparis {
  customerType?: unknown;
}

/* ── Segment anahtarları ──────────────────────────────────────────────────── */

/**
 * Phase 124'ün `o.customerType || 'Retail'` kuralı: dolu bir değer AYNEN korunur
 * (tanınmayan tip kendi satırını alır), boş/boşluk/metin olmayan → 'Retail'.
 */
export function tipSegmenti(o: TipliSiparis): string {
  const t = typeof o.customerType === 'string' ? o.customerType.trim() : '';
  return t === '' ? 'Retail' : t;
}

/** Phase 106'nın üç kovası: B2B / Dealer / geri kalan her şey (boş dâhil). */
export function donutSegmenti(o: TipliSiparis): 'B2B' | 'Dealer' | 'Retail' {
  const t = tipSegmenti(o);
  return t === 'B2B' ? 'B2B' : t === 'Dealer' ? 'Dealer' : 'Retail';
}

/** Phase 79'un iki kovası: B2B / B2B olmayan (etiketi sayfa koyar: "Perakende"). */
export function b2bSegmenti(o: TipliSiparis): 'B2B' | 'Diger' {
  return tipSegmenti(o) === 'B2B' ? 'B2B' : 'Diger';
}

/* ── Ortak yardımcılar ────────────────────────────────────────────────────── */

/** Müşteri adı — dolu metin değilse `null` (ekranda '—'); tüm adsızlar TEK kovada toplanır. */
function musteriAdi(o: { customerName?: unknown }): string | null {
  return typeof o.customerName === 'string' && o.customerName.trim() !== '' ? o.customerName : null;
}

/* Ölçek çubuğu kuralı (`CubukSatiri` / `olcekReferansi` / `cubukOrani`) BURADAN ÇIKARILDI
 * (2026-09-19 hakem turu): aynı sayfadaki "En Çok Satan Ürünler" paneli kendi, ÇELİŞEN
 * kuralını kuruyordu (kısmi tepeden ölçek + kısmi satırdan çubuk). Kural artık iki modülün
 * de okuduğu tek kaynakta: `./cubuk` (yorumlar da oraya taşındı). */

/** Listeyi anahtara göre kovalara ayırır; kova sırası ilk görülme sırasıdır. */
function kovala<O, K>(liste: readonly O[], anahtar: (o: O) => K): Map<K, O[]> {
  const kovalar = new Map<K, O[]>();
  for (const o of liste) {
    const k = anahtar(o);
    const mevcut = kovalar.get(k);
    if (mevcut) mevcut.push(o); else kovalar.set(k, [o]);
  }
  return kovalar;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Phase 160 — Müşteri ödeme davranışı
 * ──────────────────────────────────────────────────────────────────────────── */

/** Bir müşterinin ekrana giden tutarı + kaç kaydının tutarının bilinmediği. */
export interface MusteriTutari {
  /** Dolu ad ya da `null` (ekranda '—'). */
  ad: string | null;
  /** EKRAN toplamı: bilinenlerin kısmi toplamı; hiç bilinen yoksa NaN → '—'. */
  tutar: number;
  siparisSayisi: number;
  /** Tutarı bilinmeyen sipariş sayısı — ekran "N kayıt tutarsız" der. */
  tutarsizSiparis: number;
}

export interface OdemeDavranisiSonucu {
  /** En çok ödeme yapanlar (azalan; tutarı bilinmeyen müşteri SONDA). */
  odeyenler: MusteriTutari[];
  /** Ödenmemiş alacak — yalnız ödemesi Cetpa'da izlenen siparişler (`odemeTakipli`). */
  borclular: MusteriTutari[];
  /** Ödenmiş tarafta tutarı bilinmeyen sipariş sayısı (kart geneli). */
  odeyenTutarsiz: number;
  /** Alacak tarafında tutarı bilinmeyen sipariş sayısı (kart geneli). */
  borcluTutarsiz: number;
}

function musteriKirilimi<O extends MusteriSiparisi>(siparisler: readonly O[], n: number): { satirlar: MusteriTutari[]; tutarsiz: number } {
  const kovalar = kovala(siparisler, musteriAdi);
  const satirlar: MusteriTutari[] = [];
  let tutarsiz = 0;
  for (const [ad, grup] of kovalar) {
    const t = toplaBilinen(grup, siparisTutari);
    tutarsiz += t.bilinmeyen;
    satirlar.push({ ad, tutar: ekranTutari(t), siparisSayisi: grup.length, tutarsizSiparis: t.bilinmeyen });
  }
  satirlar.sort((a, b) => sayiSirala(a.tutar, b.tutar, true));
  return { satirlar: satirlar.slice(0, n), tutarsiz };
}

/**
 * Phase 160: en çok ödeme yapanlar + ödenmemiş alacak.
 * İptal edilen siparişler her iki tarafta da elenir (eski blokla aynı); alacak tarafında
 * ayrıca Mikro kaynaklı kayıtlar elenir — onların tahsilat gerçeği Mikro cari hesapta yaşar.
 */
export function odemeDavranisi<O extends MusteriSiparisi>(siparisler: readonly O[], n = 5): OdemeDavranisiSonucu {
  const canli = siparisler.filter(o => o.status !== 'Cancelled');
  const odenen = musteriKirilimi(canli.filter(o => o.paid === true), n);
  const borc = musteriKirilimi(canli.filter(o => o.paid !== true && odemeTakipli(o)), n);
  return {
    odeyenler: odenen.satirlar,
    borclular: borc.satirlar,
    odeyenTutarsiz: odenen.tutarsiz,
    borcluTutarsiz: borc.tutarsiz,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Phase 79 + Phase 106 — Segment cirosu ve pay yüzdeleri
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SegmentCiro {
  anahtar: string;
  /** EKRAN toplamı (kısmi olabilir; hiç bilinen yoksa NaN → '—'). Siparişi yoksa gerçek 0. */
  ciro: number;
  /** Bu segmentte tutarı bilinmeyen sipariş sayısı. */
  tutarsiz: number;
  siparisSayisi: number;
  /**
   * Genel toplamdaki pay (%), HAM (yuvarlama çağıranda). TÜRETME: genel toplamın TAMAMI
   * bilinmiyorsa ya da 0 ise `null` → dilim/çubuk/rozet ÇİZİLMEZ.
   */
  yuzde: number | null;
}

export interface SegmentCiroSonucu {
  /** `anahtarlar` verildiyse o sırada (eksikler 0 ciroyla dâhil); yoksa azalan ciroya göre. */
  segmentler: SegmentCiro[];
  /** EKRAN geneli — kısmi olabilir; hiç bilinen yoksa NaN. */
  toplam: number;
  /** TÜRETME geneli — tek tutar bile bilinmiyorsa NaN. Yüzdelerin paydası budur. */
  tamToplam: number;
  /** Tutarı bilinmeyen sipariş sayısı (genel). */
  tutarsiz: number;
  /** Yüzdeler hesaplanabildi mi? (`tamToplam` sonlu ve > 0) */
  yuzdelerGecerli: boolean;
  /** Halkanın merkezine yazılan en büyük segment; cirosu bilinmiyorsa `null`. */
  enBuyuk: SegmentCiro | null;
}

/**
 * Phase 79 (`b2bSegmenti`) ve Phase 106 (`donutSegmenti`) için ciro dağılımı.
 * Pay yüzdesi TÜRETMEDİR: tek siparişin tutarı bile bilinmiyorsa hiçbir yüzde üretilmez —
 * eksik bir toplamdan çıkarılan "%100 B2B" sahte kesinliktir.
 */
export function segmentCirosu<O extends SegmentSiparisi>(
  siparisler: readonly O[],
  segmentle: (o: O) => string,
  anahtarlar?: readonly string[],
): SegmentCiroSonucu {
  const genel = toplaBilinen(siparisler, siparisTutari);
  const toplam = ekranTutari(genel);
  const tamToplam = tamTutar(genel);
  const yuzdelerGecerli = Number.isFinite(tamToplam) && tamToplam > 0;

  const kovalar = kovala(siparisler, segmentle);
  const yap = (anahtar: string, grup: readonly O[]): SegmentCiro => {
    const t = toplaBilinen(grup, siparisTutari);
    const ciro = ekranTutari(t);
    return {
      anahtar,
      ciro,
      tutarsiz: t.bilinmeyen,
      siparisSayisi: grup.length,
      yuzde: yuzdelerGecerli && Number.isFinite(ciro) ? (ciro / tamToplam) * 100 : null,
    };
  };

  let segmentler: SegmentCiro[];
  if (anahtarlar) {
    // Sabit sıra (halka efsanesi/çubuk sırası sayfada sabit): istenen anahtarlar önce,
    // beklenmedik bir tip çıkarsa sonuna azalan ciroyla eklenir — sessizce YUTULMAZ.
    const kalanlar = [...kovalar.keys()].filter(k => !anahtarlar.includes(k));
    segmentler = [
      ...anahtarlar.map(k => yap(k, kovalar.get(k) ?? [])),
      ...kalanlar.map(k => yap(k, kovalar.get(k) ?? [])).sort((a, b) => sayiSirala(a.ciro, b.ciro, true)),
    ];
  } else {
    segmentler = [...kovalar.entries()].map(([k, g]) => yap(k, g)).sort((a, b) => sayiSirala(a.ciro, b.ciro, true));
  }

  let enBuyuk: SegmentCiro | null = null;
  for (const s of segmentler) {
    if (enBuyuk === null || sayiSirala(s.ciro, enBuyuk.ciro, true) < 0) enBuyuk = s;
  }
  if (enBuyuk !== null && !Number.isFinite(enBuyuk.ciro)) enBuyuk = null;

  return { segmentler, toplam, tamToplam, tutarsiz: genel.bilinmeyen, yuzdelerGecerli, enBuyuk };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Phase 77 — En iyi müşteriler
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MusteriCiro extends CubukSatiri {
  ad: string | null;
  siparisSayisi: number;
  /** Ölçek çubuğunun genişliği (%); ölçek ya da satır kısmiyse `null` → çubuk çizilmez. */
  barOrani: number | null;
}

export interface EnIyiMusterilerSonucu {
  /** Azalan ciro; tutarı bilinmeyen müşteri SONDA. En fazla `n` satır. */
  musteriler: MusteriCiro[];
  /** Çubuk ölçeği güvenilir mi? false ise hiçbir çubuk çizilmez (tepe değer kısmi/bilinmiyor). */
  olcekGecerli: boolean;
  /** Tutarı bilinmeyen sipariş sayısı (liste geneli). */
  tutarsiz: number;
}

/**
 * Phase 77: cirosu en yüksek müşteriler. İptal edilen siparişler ELENMEZ (eski blok da
 * elemiyordu — davranış değişikliği bu turda bilerek yapılmadı; bkz. `acikSorular`).
 */
export function enIyiMusteriler<O extends MusteriSiparisi>(siparisler: readonly O[], n = 5): EnIyiMusterilerSonucu {
  const kovalar = kovala(siparisler, musteriAdi);
  const satirlar: Omit<MusteriCiro, 'barOrani'>[] = [];
  let tutarsiz = 0;
  for (const [ad, grup] of kovalar) {
    const t = toplaBilinen(grup, siparisTutari);
    tutarsiz += t.bilinmeyen;
    satirlar.push({ ad, ciro: ekranTutari(t), siparisSayisi: grup.length, tutarsizSiparis: t.bilinmeyen });
  }
  satirlar.sort((a, b) => sayiSirala(a.ciro, b.ciro, true));
  const ilkN = satirlar.slice(0, n);
  const referans = olcekReferansi(ilkN);
  return {
    musteriler: ilkN.map(s => ({ ...s, barOrani: cubukOrani(s, referans) })),
    olcekGecerli: Number.isFinite(referans),
    tutarsiz,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Phase 124 — Segment kârlılığı
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SegmentKar extends CubukSatiri {
  anahtar: string;
  siparisSayisi: number;
  /** Segmentin COGS'u — TÜRETME: tek siparişin maliyeti bile bilinmiyorsa NaN. */
  maliyet: number;
  /** ciro − maliyet (kalem tabanlı) — biri bilinmiyorsa NaN. */
  kar: number;
  /** Ham marj yüzdesi; `null` → rozet ve renk ÇİZİLMEZ ('—'). */
  marjYuzde: number | null;
  /** Ortalama sipariş tutarı — TÜRETME: tek tutar bile bilinmiyorsa `null`. */
  ortalamaSiparis: number | null;
  /** Maliyeti çıkarılamayan sipariş sayısı — ekran "N siparişin maliyeti bilinmiyor" der. */
  maliyetsizSiparis: number;
  /** Çubuk genişliği (%); ölçek ya da satır kısmiyse `null`. */
  barOrani: number | null;
}

export interface SegmentKarSonucu {
  /** Azalan ciro (eski `sort((a,b) => b.revenue - a.revenue)`); cirosu bilinmeyen segment SONDA. */
  segmentler: SegmentKar[];
  /** Çubuk ölçeği güvenilir mi? */
  olcekGecerli: boolean;
}

/**
 * Phase 124: segment bazlı ciro / maliyet / marj.
 *
 * `karHesapla` siparişin kârlılığını verir; sayfa bunu `siparisKarlilik.siparisKarliligi` ile
 * kurar (maliyet çözücüsü stok kartından gelir ve BİLİNMEYENİ `null` bildirmelidir —
 * `itemCostTRY` 0 döndüğü için doğrudan kullanılamaz; `kartMaliyetiTL` kullanılır).
 * Maliyet tek yerden gelsin diye burada ikinci bir COGS kopyası YAZILMAZ.
 *
 * Gösterilen `ciro` başlık tutarından (`siparisTutari`) gelir — Phase 79/106/77 ile aynı taban,
 * eski blokla parite. Marj ise TAMAMEN kalem tabanında (`siparisKarliligi.ciro` / `.maliyet`)
 * hesaplanır: kârın iki tarafı aynı tabanda olmak zorundadır (bkz. siparisKarlilik.ts).
 */
export function segmentKarliligi<O extends SegmentSiparisi>(
  siparisler: readonly O[],
  segmentle: (o: O) => string,
  karHesapla: (o: O) => SiparisKarlilik,
): SegmentKarSonucu {
  const canli = siparisler.filter(o => o.status !== 'Cancelled');
  const kovalar = kovala(canli, segmentle);

  const segmentler: SegmentKar[] = [...kovalar.entries()].map(([anahtar, grup]) => {
    const t = toplaBilinen(grup, siparisTutari);
    const tam = tamTutar(t);
    const karlar = grup.map(karHesapla);

    const maliyet = tamTutar(toplaBilinen(karlar, k => k.maliyet));
    const kalemCirosu = tamTutar(toplaBilinen(karlar, k => k.ciro));
    const kar = tamTutar(toplaBilinen(karlar, k => k.kar));

    return {
      anahtar,
      ciro: ekranTutari(t),
      tutarsizSiparis: t.bilinmeyen,
      siparisSayisi: grup.length,
      maliyet,
      kar,
      marjYuzde: Number.isFinite(kar) && Number.isFinite(kalemCirosu) && kalemCirosu > 0
        ? (kar / kalemCirosu) * 100
        : null,
      ortalamaSiparis: Number.isFinite(tam) && grup.length > 0 ? tam / grup.length : null,
      maliyetsizSiparis: karlar.reduce((s, k) => (Number.isFinite(k.maliyet) ? s : s + 1), 0),
      barOrani: null,   // ölçek tüm segmentler çıkınca belli olur (aşağıda doldurulur)
    };
  });

  segmentler.sort((a, b) => sayiSirala(a.ciro, b.ciro, true));
  const referans = olcekReferansi(segmentler);
  for (const s of segmentler) s.barOrani = cubukOrani(s, referans);

  return { segmentler, olcekGecerli: Number.isFinite(referans) };
}
