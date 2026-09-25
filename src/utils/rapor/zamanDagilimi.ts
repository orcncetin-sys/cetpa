/**
 * zamanDagilimi.ts — rapor ekranlarının ZAMAN KOVASI çekirdeği: siparişi kendi tarihinden
 * türeyen SABİT UZUNLUKTA indeksli kovalara yerleştirir. Test: zamanDagilimi.test.ts (ÖNCE yazıldı).
 * Faz 3 6/n (rapor ekranları), 2026-09-19.
 *
 * ## NEDEN VAR — ölçülen sahte kesinlik siteleri (src/components/reports/genel/GenelOzet.tsx, HEAD 46c53a8)
 *
 * Phase 186 "Saate Göre Satış Dağılımı" (308-352) — 8 kova × 3 saat:
 *   319  `if (bucket) { bucket.count++; bucket.rev += o.totalPrice || 0; }`
 *   324  `const peakBucket = hourBuckets186.reduce((best, b) => b.count > best.count ? b : best, hourBuckets186[0]);`
 * Phase 147 "Güne Göre Satış Dağılımı" (355-396) — 7 kova × hafta günü:
 *   365  `dayCounts[d.getDay()].revenue += o.totalPrice || 0;`
 *   370  `const bestDay = dayCounts.reduce((best, d) => d.revenue > best.revenue ? d : best, dayCounts[0]);`
 *
 * Üç arıza, ikisi de iki panelde birden:
 *   (1) `|| 0` — tutarı BİLİNMEYEN sipariş o kovaya ₺0 yazıyor. Kova cirosu sessizce eksik çıkıyor,
 *       ekranda hiçbir iz kalmıyor (CLAUDE.md: bilinmeyen sayı 0 DEĞİL bilinmiyordur — SAYILIR).
 *   (2) `reduce(..., kovalar[0])` — hiç kayıt kovalanmadığında ya da tüm cirolar bilinmiyor/₺0 iken
 *       rozet YİNE DE basılıyor: "Zirve: 0:00-2:59", "En iyi gün: Paz". Veri yokken üretilmiş sayı.
 *   (3) P186'da `find` eşleşmezse (`if (bucket)`) öğe SESSİZCE düşüyor — kapsam dışı indeks sayılmıyor.
 *
 * ## PARİTE
 * Tarihi çözülen + kapsam içi girdide ADETLER kapalı modül `stokSevkiyat.haftaIciIsiHaritasi` ile
 * BİREBİR aynıdır (zamanDagilimi.test.ts test 1: aynı vektörde `.kovalar.map(k => k.adet)` ≡
 * `.sayilar`, `tarihsiz` ve `enYogun === enYogunGun` eşit). Beraberlikte İLK indeks — `indexOf(max)`
 * ile aynı, eski iki panelin `reduce(b.count > best.count)` davranışıyla da aynı.
 *
 * ## BİLİNÇLİ FARKLAR (rakamı değiştirenler — hepsi yukarıdaki üç arızanın düzeltmesi)
 *   • Kova cirosu çıplak `number` değil `Tutar`: bilinen KISMİ toplam + bilinen/bilinmeyen sayaçları.
 *     Tutarı bilinmeyen sipariş artık kovaya ₺0 yazmıyor, `ciro.bilinmeyen`de sayılıyor.
 *   • `enYogun` / `enCokCiro` aday yoksa `null` — çağıran rozeti ÇİZMEZ ('—').
 *   • Meşru ₺0 ciro tepe adayı DEĞİL (`ciro.toplam > 0` şartı): "En iyi gün" ₺0 üstüne basılmaz.
 *   • Kapsam dışı indeks (`indeksSec` aralık dışı / tam sayı olmayan değer döndürdü) `kapsamDisi`de.
 *   • Değişmez: `Σ adet + tarihsiz + kapsamDisi === liste.length` — hiçbir kayıt izsiz kaybolmaz.
 * Çağıran `tarihsiz` + `kapsamDisi` + `ciro.bilinmeyen` sayaçlarını ekranda göstermeli
 * (CLAUDE.md: '—' VEYA açık not).
 *
 * ## KAPSAM DIŞI (bilerek)
 * İptal süzgeci bu modülde YOK. KULLANICI KARARI K2 (2026-09-19) — kullanıcının kendi cümlesi:
 * **"İptaller ciroya girsin mi → hayır."** Bu kural TEK yerde, `raporCirosu`/çağıranın süzgecinde
 * durur (`o.status !== 'Cancelled'`); genel kovalayıcı durum alanını OKUMAZ, kendisine ne verilirse
 * onu kovalar. ÖLÇÜLDÜ: iki panel de bugün zaten `if (o.status === 'Cancelled') continue;` ile
 * atlıyor (:312, :361) → K2 bu iki panelde rakam DEĞİŞTİRMEZ; bağlama süzgeci sadece KORUR.
 * P186 bir ADET panelidir ama AYNI kümeyi kullanır (tek kartta iki farklı sipariş kümesi olmasın).
 * `mevsimsellikEndeksi` (6b eki) de aynı karardadır: sipariş okumaz, kovaları alır; GB3 mevsimsellik paneli
 * (`:554-561`) bugün iptalleri DIŞLAMIYOR → K2 bağlama süzgeciyle uygulanır, rakam DEĞİŞİR (beklenen).
 *
 * ## 6b EKİ (2026-09-24, Faz 3 6/n Genel I) — `mevsimsellikEndeksi` (ADDITIVE; `zamanKovalari` DOKUNULMADI)
 * Neden var — src/components/reports/genel/GenelBloklar3.tsx:553-598 "Ciro Mevsimsellik Endeksi" (HEAD 912d750):
 *   :560 `monthRevenue[m].push(o.totalPrice);`                         — bilinmeyen tutar `undefined` giriyor → :565 reduce
 *        NaN → o ay TÜMDEN kayboluyor, ekranda iz yok
 *   :565 `vals.length > 0 ? Σ/len : 0`                                   — ay ortalaması TÜRETME; boş ay 0 → "veri yok" ile
 *        "ciro sıfır" ayırt edilemiyor
 *   :567 `… / Math.max(1, monthAvg.filter(v=>v>0).length)`               — sahte payda; süzgeç iki kez (kopya)
 *   :572 `peakMonth = seasonality.reduce(…, -1)`                         — -1 kalabilir → :576 `monthNames[-1]` = "peak: undefined"
 * Aynı hesabın ikinci kopyası GenelBloklar6.tsx:140-156 (×100 biçim, "100 = average month") — aynı taban, GB6 bağlaması AYRI alt faz.
 * TABAN (K28 kullanıcı: "Dönem tanımları: parite + adlandırma"): AY ORTALAMASI (`tamTutar(ciro) / adet`), genel ortalama =
 *   ölçülen ayların AĞIRLIKSIZ aritmetik ortalaması — GB3:565/GB6:152 ile AYNI tanım. AY TOPLAMI tabanı YAZILMADI (tüketicisi yok).
 * PARİTE: hepsi bilinen girdide endeksler eski formülle BİREBİR (test 1); `avg > 0` süzgeci korunur (meşru ₺0 ay da
 *   `verisizAy` — gerçek sıfır ile "veri yok" ayrımı ayrı karar ister, orkestratöre açık soru).
 * BİLİNÇLİ FARKLAR (mevsimsellikEndeksi): ay ortalaması TÜRETMEdir (`tamTutar` kapısı) — ayda tutarı okunamayan TEK kayıt
 *   varsa o ay ölçülemez (`tutarsizAy`, endeks `null`) ve tabana GİRMEZ; `olculenAy === 0` → hepsi `null`, `zirve null`
 *   (sahte payda `Math.max(1, …)` YOK); zirve aday yoksa `null` (-1 DEĞİL); endeks KIRPILMAZ (bugünkü `Math.min(80, s*40)`
 *   ÇAĞIRANIN ölçek işi, `cubuk.ts`). Sayaçlar AYRIKTIR: `olculenAy + tutarsizAy + verisizAy === aylar.length`.
 *
 * ## `segmentCirosu`'na neden BAĞLANMADI (`src/utils/pano/musteriAnaliz.ts:248`)
 * O yardımcı her siparişi bir METİN segmentine koymak zorundadır (tarihi çözülemeyen / aralık dışı
 * kayıt için `tarihsiz` · `kapsamDisi` kanalı yok — uydurma bir segment doğardı), kova cirosunu
 * `Tutar` değil `ekranTutari` SAYISI olarak döndürür ve tepe noktasını CİROYA göre üretir. Burada
 * gereken ise sabit uzunlukta İNDEKSLİ kovalar, yalnız-ADET modu (P186 tutar okumaz) ve ADET
 * tepesidir. Ortak olan tek parça (kova toplamı) zaten `kovayaEkle` ile paylaşılıyor; üstelik
 * `musteriAnaliz.ts` kapalı 5/n modülüdür (DOKUNULMAZ).
 *
 * ## DOKUNULMADI
 * `stokSevkiyat.haftaIciIsiHaritasi` / `IsiHaritasi` / `TarihliSiparis` — imza, gövde ve testleri
 * AYNEN durur (kapalı modül). Onu buna indirmek 6m sonrası ayrı iştir; sapma test 1 ile kilitli.
 */
import { tamTutar, type Tutar } from '../para';
import { zamanDate } from '../zaman';
import { BOS_TUTAR, kovayaEkle } from '../pano/raporVeriKatmani';
import type { TarihliSiparis } from '../pano/stokSevkiyat';

/** Tek kova: öğe adedi + kova cirosu (`tutarSec` verilmediyse `BOS_TUTAR`). */
export interface ZamanKovasi {
  adet: number;
  ciro: Tutar;
}

export interface ZamanKovalari {
  /** Uzunluk = `kovaSayisi`; indeks = `indeksSec`in döndürdüğü değer (etiketi ÇAĞIRAN dizer). */
  kovalar: ZamanKovasi[];
  /** Tarihi ÇÖZÜLEMEYEN kayıt sayısı — hiçbir kovaya yazılmaz, SAYILIR (epoch 0 / "bugün" yedeği YOK). */
  tarihsiz: number;
  /** `indeksSec` aralık dışı ya da tam sayı olmayan indeks döndürdü — eskiden SESSİZCE düşüyordu. */
  kapsamDisi: number;
  /** ADET tepe indeksi (beraberlikte İLK); hiç kayıt kovalanmadıysa `null` — rozet ÇİZİLMEZ. */
  enYogun: number | null;
  /** Bilinen POZİTİF ciro tepe indeksi (beraberlikte İLK); aday yoksa `null` — rozet ÇİZİLMEZ. */
  enCokCiro: number | null;
}

export interface ZamanKovasiSecenek<T> {
  /**
   * Tarih alanı. Varsayılan `o => o.createdAt ?? o.syncedAt` — `haftaIciIsiHaritasi` ile AYNI
   * (alan VARSA ve çözülemiyorsa yedeğe DÜŞÜLMEZ). 6a bağlaması parite için `o => o.createdAt`
   * geçer: bugünkü iki panel (P186/P147) yalnız `createdAt` okuyor.
   */
  tarihSec?: (o: T) => unknown;
  /** Ciro alanı. Verilmezse ciro HİÇ okunmaz (`BOS_TUTAR`) ve `enCokCiro` `null` kalır. */
  tutarSec?: (o: T) => unknown;
}

/** Sayfa paritesi: `haftaIciIsiHaritasi`nın `varsayilanSiparisTarihi` ile aynı kural. */
const varsayilanTarih = (o: TarihliSiparis): unknown => o.createdAt ?? o.syncedAt;

/**
 * Siparişleri tarihlerinden türeyen indeksli kovalara yerleştirir.
 *
 * `T extends TarihliSiparis` ZORUNLU: varsayılan `tarihSec` `o.createdAt ?? o.syncedAt` okur,
 * kısıtsız `T`'de derlenmez.
 *
 * @param kovaSayisi Pozitif TAM SAYI; değilse `throw` (sessiz boş sonuç, panelin bozuk
 *   yapılandırmayı fark etmeden "veri yok" basmasına yol açardı).
 * @param indeksSec Tarihten kova indeksi (`d => d.getDay()`, `d => Math.floor(d.getHours() / 3)`…).
 *   `[0, kovaSayisi)` dışında ya da tam sayı olmayan bir değer dönerse kayıt `kapsamDisi` sayılır.
 */
export function zamanKovalari<T extends TarihliSiparis>(
  liste: readonly T[],
  kovaSayisi: number,
  indeksSec: (d: Date) => number,
  secenek?: ZamanKovasiSecenek<T>,
): ZamanKovalari {
  if (!Number.isInteger(kovaSayisi) || kovaSayisi <= 0) {
    throw new Error(`zamanKovalari: kovaSayisi pozitif tam sayı olmalı (geldi: ${String(kovaSayisi)})`);
  }

  const tarihSec = secenek?.tarihSec ?? varsayilanTarih;
  const tutarSec = secenek?.tutarSec;

  const kovalar: ZamanKovasi[] = Array.from({ length: kovaSayisi }, () => ({ adet: 0, ciro: BOS_TUTAR }));
  let tarihsiz = 0;
  let kapsamDisi = 0;

  for (const o of liste) {
    const d = zamanDate(tarihSec(o));
    if (d === null) { tarihsiz += 1; continue; }

    const i = indeksSec(d);
    // `Number.isInteger` NaN'ı da eler — `isFinite` global sürümü DEĞİL (CLAUDE.md).
    if (!Number.isInteger(i) || i < 0 || i >= kovaSayisi) { kapsamDisi += 1; continue; }

    const kova = kovalar[i];
    kova.adet += 1;
    // `kovayaEkle` YENİ nesne döndürür — paylaşılan donuk `BOS_TUTAR` mutasyona uğramaz.
    if (tutarSec) kova.ciro = kovayaEkle(kova.ciro, tutarSec(o));
  }

  return { kovalar, tarihsiz, kapsamDisi, enYogun: enBuyukIndeks(kovalar, k => k.adet), enCokCiro: enCokCiroIndeksi(kovalar) };
}

/**
 * Beraberlikte İLK indeks (`indexOf(max)` ile aynı; `>` kullanır, `>=` DEĞİL). Hiç POZİTİF
 * değer yoksa `null` — "tepe" diye 0 döndürmek (eski `reduce(..., kovalar[0])`) uydurmadır.
 */
function enBuyukIndeks(kovalar: readonly ZamanKovasi[], sec: (k: ZamanKovasi) => number): number | null {
  let enIyi = -1;
  let enBuyuk = 0;
  for (let i = 0; i < kovalar.length; i++) {
    const v = sec(kovalar[i]);
    if (v > enBuyuk) { enBuyuk = v; enIyi = i; }
  }
  return enIyi === -1 ? null : enIyi;
}

/**
 * Ciro tepesi: yalnız `bilinen > 0 && toplam > 0` kovalar aday. KISMİ kova (içinde bilinmeyen
 * tutar olan) da adaydır — çağıran yanına "N kayıt tutarsız" notunu basar; ama hiç aday yoksa
 * `null` döner ("En iyi gün: Paz" uydurması biter). Meşru ₺0 ciro de tepe DEĞİLDİR.
 */
function enCokCiroIndeksi(kovalar: readonly ZamanKovasi[]): number | null {
  return enBuyukIndeks(kovalar, k => (k.ciro.bilinen > 0 ? k.ciro.toplam : 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mevsimsellik endeksi (6b eki, 2026-09-24 — GenelBloklar3 :553-598, GenelBloklar6 :140-156)
// ─────────────────────────────────────────────────────────────────────────────

export interface MevsimsellikSonucu {
  /**
   * Ay başına endeks: `ay ortalaması / genel ortalama` (1 = ortalama ay).
   * ÖLÇÜLEMEYEN ay `null` — 0 DEĞİL (grafikte sıfıra çakılmasın, `cubukOrani` çubuğu çizmesin).
   * Uzunluk = girdi uzunluğu.
   */
  endeksler: (number | null)[];
  /** Tabanı kuran ay sayısı (endeksi `null` olmayanlar). */
  olculenAy: number;
  /** İçinde tutarı okunamayan sipariş olan ay — ortalaması TÜRETİLEMEZ, endeks `null`. */
  tutarsizAy: number;
  /** Hiç kaydı olmayan YA DA bilinen ortalaması `<= 0` olan ay — endeks `null` (bugünkü davranışın paritesi). */
  verisizAy: number;
  /** En yüksek endeksli ay (beraberlikte İLK); aday yoksa `null` — 'peak: undefined' biter. */
  zirve: number | null;
}

/**
 * Sabit uzunluklu ay kovalarından (tipik olarak `zamanKovalari(liste, 12, d => d.getMonth(), { tutarSec })`)
 * mevsimsellik endeksi. Taban = AY ORTALAMASI (ciro / adet) — GB3:565 ve GB6:152 ile AYNI tanım
 * (K28: dönem tanımı parite + adlandırma). AY TOPLAMI tabanı YAZILMAZ: bugün tüketicisi YOK.
 *
 * - Ay ortalaması TÜRETMEdir: `tamTutar(k.ciro) / k.adet`. Ayda tutarı okunamayan TEK kayıt varsa `tamTutar` NaN →
 *   o ay ölçülemez (`tutarsizAy++`, `endeksler[i] = null`) ve tabana GİRMEZ (kısmi ortalamadan endeks üretilmez).
 * - `k.adet === 0` ya da ortalama `<= 0` → `verisizAy++`, `endeksler[i] = null` (parite: bugün `avg > 0` süzgeci).
 * - Sayaçlar AYRIK — her ay tam olarak bir sayaca girer. DEĞİŞMEZ: `olculenAy + tutarsizAy + verisizAy === aylar.length`.
 * - Genel ortalama = ölçülen ayların ortalamalarının AĞIRLIKSIZ aritmetik ortalaması (bugünkü tanım).
 *   `olculenAy === 0` → `endeksler` hepsi `null`, `zirve === null` (sahte payda `Math.max(1, …)` YOK).
 * - `zirve`: en büyük endeks, beraberlikte İLK indeks (`>` ile, `>=` DEĞİL — `enBuyukIndeks` kuralıyla aynı; o yardımcı
 *   `ZamanKovasi` okuduğu için burada endeks dizisi üzerinde aynı kural yerinde uygulanır). Aday yoksa `null`.
 * - Endeks KIRPILMAZ; saf: tarih çözmez, sipariş okumaz, dil/metin yok. İptal süzgeci ÇAĞIRANDA (K2). Girdi mutasyona uğramaz.
 */
export function mevsimsellikEndeksi(aylar: readonly ZamanKovasi[]): MevsimsellikSonucu {
  let tutarsizAy = 0;
  let verisizAy = 0;
  const ortalamalar: (number | null)[] = aylar.map(k => {
    if (k.adet === 0) { verisizAy += 1; return null; }                 // hiç kayıt yok
    const tam = tamTutar(k.ciro);                                      // TÜRETME kapısı: tek tutarsız kayıt → NaN
    if (!Number.isFinite(tam)) { tutarsizAy += 1; return null; }
    const ortalama = tam / k.adet;
    if (!(ortalama > 0)) { verisizAy += 1; return null; }              // parite: `avg > 0` süzgeci (meşru ₺0 ay dâhil)
    return ortalama;
  });

  const olculen = ortalamalar.filter((v): v is number => v !== null);
  const olculenAy = olculen.length;
  if (olculenAy === 0) {
    return { endeksler: aylar.map(() => null), olculenAy: 0, tutarsizAy, verisizAy, zirve: null };
  }
  const genelOrtalama = olculen.reduce((toplam, v) => toplam + v, 0) / olculenAy;
  const endeksler = ortalamalar.map(v => (v === null ? null : v / genelOrtalama));

  // Beraberlikte İLK indeks (`>`); aday yoksa null — eski `reduce(…, -1)` "peak: undefined" basıyordu.
  let zirve: number | null = null;
  let enBuyuk = 0;
  endeksler.forEach((e, i) => { if (e !== null && e > enBuyuk) { enBuyuk = e; zirve = i; } });

  return { endeksler, olculenAy, tutarsizAy, verisizAy, zirve };
}
