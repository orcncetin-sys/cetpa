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
 *
 * ## 6c EKİ (2026-10-17, Faz 3 6/n Genel II) — `haftaGunIzgarasi` + `aktifGunSerisi` (ADDITIVE; yukarıdakiler DOKUNULMADI)
 * ### `haftaGunIzgarasi` — `zamanKovalari` SARMALAYICISI (hafta × gün CİRO ızgarası)
 * Neden var — src/components/reports/genel/GenelBloklar4.tsx P445 ısı haritası:
 *   `weekAgo = Math.floor((now351 - ts) / (7 * 86400000)); if (weekAgo > 7) return;` — gelecek tarihli kayıt (`weekAgo < 0`)
 *   `grid['-1-x']`e yazılıp hiç ÇİZİLMİYOR ama ölçeği ve dolu hücre sayısını ŞİŞİRİYOR; 8 haftadan eski kayıt SESSİZCE
 *   düşüyor; `grid[key] = (grid[key] || 0) + (o.totalPrice || 0)` tutarı bilinmeyeni ₺0 sayıyor.
 *   `stokSevkiyat.haftaIciIsiHaritasi` yalnız 7 kovalı ADET verir — hafta × gün CİRO ızgarası değil, o yüzden yeni export.
 *   • Hafta KAYAN haftadır (son 7×24 saat — GB4 paritesi); h = 0 içinde bulunulan hafta, g = `getDay()` (0 = Pazar).
 *     Gelecek tarihli ve `haftaSayisi`'ndan eski kayıt `kapsamDisi`de SAYILIR. `tutarSec` ZORUNLU (ciro ızgarası:
 *     verilmeseydi `zamanKovalari` ciroyu hiç okumaz, panel sessizce "veri yok" basardı).
 *   • Yoğunluk / ölçek ÇAĞIRANDA (`pano/cubuk.olcekReferansi` + `cubukOrani`; bilinmeyenli hücre renk ALMAZ). Sütun sırası
 *     (O17: "8w ago … Now" etiketi ile sıra TERS'ti) bağlamanın işi — yardımcı h = 0 = şimdi döndürür.
 * ### `aktifGunSerisi` — orkestratör kararı O17 (tek aktif gün = 1)
 * Neden var — GenelBloklar4.tsx P528 «Ciro Süreklilik Serisi»: `gunAnahtari(o.createdAt); if (!key) return;` tarihi
 *   çözülemeyen kaydı SESSİZCE düşürüyor; `let maxStreak = 0, cur = 1; … if (diff === 1) { cur++; maxStreak = … }` ardışık
 *   iki gün yokken "en uzun seri 0" basıyor (aynı kartta "toplam 3 aktif gün" yazarken); gün geri sarma milisaniyeyle.
 *   • Takvim günüyle geri sarar (`new Date(y, m, g − k)`); sonsuz `while (true)` YOK (döngü aktif gün sayısıyla sınırlı).
 *   • Para OKUMAZ: tutarı bilinmeyen sipariş de günü aktif sayar (O16 "sipariş varlığından"); TRY dışı sipariş bu
 *     yardımcıda bozuk veri değildir (O21'den etkilenmez). `aktifGun` gelecek tarihli günü de sayar (parite).
 * ### TRY dışı sipariş (O21) — ayrım ÇAĞIRANDA
 * `haftaGunIzgarasi` `dovizTutar` / `paraBirimi` OKUMAZ; TRY dışı mağaza siparişi verilirse hücresi «tutarı bilinmeyen»
 * olur ve renk almaz. Çağıran `siparisler/magazaSiparisi.tryDisiMi` ile ayırır, `dovizli` sayısını kendi notunda verir.
 * K2 · İptaller ciroya girsin mi → "hayır". — iki yardımcı da `status` okumaz; süzgeç ÇAĞIRANDA.
 */
import { tamTutar, type Tutar } from '../para';
import { zamanDate, gunAnahtari, gunFarki } from '../zaman';
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

// ─────────────────────────────────────────────────────────────────────────────
// Hafta × gün ciro ızgarası (6c eki, 2026-10-17 — GenelBloklar4 P445 ısı haritası)
// ─────────────────────────────────────────────────────────────────────────────

/** KAYAN hafta = son 7×24 saat (GB4 P445 paritesi: `Math.floor((now - ts) / (7 * 86400000))`). */
const HAFTA_MS = 7 * 86400000;

/** `tutarSec` ZORUNLU: bu bir CİRO ızgarasıdır. Verilmeseydi `zamanKovalari` ciroyu HİÇ okumaz, her hücre `BOS_TUTAR` kalır ve panel sessizce "veri yok" basardı. */
export type HaftaGunSecenek<T> = ZamanKovasiSecenek<T> & { tutarSec: (o: T) => unknown };

export interface HaftaGunIzgarasi {
  /** `hucreler[h][g]` — h = 0 içinde bulunulan KAYAN hafta (son 7×24 saat), h = haftaSayisi−1 en eski; g = `getDay()` (0 = Pazar). */
  hucreler: ZamanKovasi[][];
  tarihsiz: number;
  /** `haftaSayisi` haftadan eski YA DA `simdi`den SONRA (gelecek tarihli) kayıt — eskiden biri sessizce düşüyor, öbürü ölçeği şişiriyordu. */
  kapsamDisi: number;
}

/**
 * Son `haftaSayisi` KAYAN haftanın hafta × gün ciro ızgarası — `zamanKovalari` SARMALAYICISI (kovalama, tarih çözümü,
 * tutar ve sayaç kuralı orada TEK yerde). Tutarı bilinmeyen kayıt hücrenin `ciro.bilinmeyen`ine düşer (₺0 DEĞİL) ve
 * `adet`e dâhildir. DEĞİŞMEZ: `Σ adet + tarihsiz + kapsamDisi === liste.length`. `haftaSayisi` pozitif TAM SAYI değilse throw.
 */
export function haftaGunIzgarasi<T extends TarihliSiparis>(
  liste: readonly T[],
  haftaSayisi: number,
  simdi: Date,
  secenek: HaftaGunSecenek<T>,
): HaftaGunIzgarasi {
  if (!Number.isInteger(haftaSayisi) || haftaSayisi <= 0) {
    throw new Error(`haftaGunIzgarasi: haftaSayisi pozitif tam sayı olmalı (geldi: ${String(haftaSayisi)})`);
  }
  const z = zamanKovalari(liste, haftaSayisi * 7, d => {
    const h = Math.floor((simdi.getTime() - d.getTime()) / HAFTA_MS);
    // Açık -1 okunurluk içindir: gelecek (h < 0) ve eski (h ≥ haftaSayisi) kayıt `zamanKovalari`'nda `kapsamDisi` sayılır.
    return h < 0 || h >= haftaSayisi ? -1 : h * 7 + d.getDay();
  }, secenek);
  const hucreler = Array.from({ length: haftaSayisi }, (_, h) => z.kovalar.slice(h * 7, h * 7 + 7));
  return { hucreler, tarihsiz: z.tarihsiz, kapsamDisi: z.kapsamDisi };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aktif gün serisi (6c eki, 2026-10-17 — GenelBloklar4 P528 «Ciro Süreklilik Serisi»; O17)
// ─────────────────────────────────────────────────────────────────────────────

export interface AktifGunSerisi {
  /** `bugun`den geriye kesintisiz aktif takvim günü; bugün aktif değilse 0 (bugünkü tanım — parite). */
  mevcutSeri: number;
  /** En uzun kesintisiz aktif gün dizisi; aktif gün yoksa 0, en az bir aktif gün varsa ≥ 1 (O17: tek aktif gün = 1). */
  enUzunSeri: number;
  /** Farklı aktif gün sayısı — tarihi çözülen TÜM kayıtlar (gelecek tarihli dâhil; `daySet.size` paritesi). */
  aktifGun: number;
  /** Son `sonGunSayisi` takvim günü, en eskiden bugüne. */
  sonGunler: { anahtar: string; aktif: boolean }[];
  /** Tarihi çözülemeyen kayıt — SAYILIR. */
  tarihsiz: number;
}

/**
 * Siparişlerin aktif (en az bir kaydı olan) takvim günlerinden süreklilik serisi. Gün anahtarı `zaman.gunAnahtari`
 * (yerel gün); ardışıklık `zaman.gunFarki === 1`. Para OKUMAZ. `sonGunSayisi` pozitif TAM SAYI değilse ya da `bugun`
 * geçerli bir tarih değilse throw (sessiz boş şerit, bozuk yapılandırmayı "hiç satış yok" diye gösterirdi).
 */
export function aktifGunSerisi<T extends TarihliSiparis>(
  liste: readonly T[],
  bugun: Date,
  sonGunSayisi: number,
  tarihSec: (o: T) => unknown = varsayilanTarih,
): AktifGunSerisi {
  if (!Number.isInteger(sonGunSayisi) || sonGunSayisi <= 0) {
    throw new Error(`aktifGunSerisi: sonGunSayisi pozitif tam sayı olmalı (geldi: ${String(sonGunSayisi)})`);
  }
  const y = bugun.getFullYear(), m = bugun.getMonth(), g = bugun.getDate();
  /** `bugun`den `geri` TAKVİM günü önceki günün anahtarı (milisaniye ile geri sarma YOK). */
  const takvimGunu = (geri: number): string => {
    const a = gunAnahtari(new Date(y, m, g - geri));
    if (a === null) throw new Error('aktifGunSerisi: bugun geçerli bir tarih olmalı');
    return a;
  };
  const bugunAnahtari = takvimGunu(0);

  const gunler = new Set<string>();
  let tarihsiz = 0;
  for (const o of liste) {
    const k = gunAnahtari(tarihSec(o));
    if (k === null) { tarihsiz += 1; continue; }
    gunler.add(k);
  }

  let mevcutSeri = 0;
  for (let k = 0; k < gunler.size; k++) {
    if (!gunler.has(k === 0 ? bugunAnahtari : takvimGunu(k))) break;
    mevcutSeri += 1;
  }

  // O17: tek aktif gün = 1 (eski `maxStreak = 0` tabanı ardışık gün yokken 0 basıyordu).
  let enUzunSeri = 0;
  let zincir = 0;
  let onceki: string | null = null;
  for (const k of [...gunler].sort()) {
    zincir = onceki !== null && gunFarki(k, onceki) === 1 ? zincir + 1 : 1;
    if (zincir > enUzunSeri) enUzunSeri = zincir;
    onceki = k;
  }

  const sonGunler = Array.from({ length: sonGunSayisi }, (_, i) => {
    const anahtar = takvimGunu(sonGunSayisi - 1 - i);
    return { anahtar, aktif: gunler.has(anahtar) };
  });

  return { mevcutSeri, enUzunSeri, aktifGun: gunler.size, sonGunler, tarihsiz };
}
